#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOSTS_FILE="$SCRIPT_DIR/hosts.conf"
SSH_KEY="$HOME/.ssh/oci-key"
BASTION_KEY="$HOME/.ssh/bastion-key"
REMOTE_USER="ubuntu"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <instance>" >&2
  echo "  Instances: ozen, partzoof" >&2
  exit 1
fi

source "$HOSTS_FILE"
: "${BASTION_OCID:?BASTION_OCID not set in hosts.conf}"
: "${OCI_REGION:?OCI_REGION not set in hosts.conf}"

BASTION_HOST="host.bastion.${OCI_REGION}.oci.oraclecloud.com"

case "$1" in
  ozen)     TARGET_IP="$OZEN_IP" ;;
  partzoof) TARGET_IP="$PARTZOOF_IP" ;;
  *)
    echo "Unknown instance: $1 (valid: ozen, partzoof)" >&2
    exit 1
    ;;
esac

SESSION_ID=""
TUNNEL_PID=""
TUNNEL_PORT=""

cleanup() {
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  if [[ -n "$SESSION_ID" ]]; then
    echo "Deleting bastion session..." >&2
    "$SCRIPT_DIR/oci_create_session.py" delete "$SESSION_ID" || true
  fi
}
trap cleanup EXIT

echo "Creating bastion session for $1 ($TARGET_IP)..." >&2
SESSION_ID=$("$SCRIPT_DIR/oci_create_session.py" create "$BASTION_OCID" "$TARGET_IP" "$1")

echo "Waiting for session to become ACTIVE..." >&2
attempts=0
while true; do
  sleep 5
  state=$("$SCRIPT_DIR/oci_create_session.py" get "$SESSION_ID")
  [[ "$state" == "ACTIVE" ]] && { sleep 5; break; }
  attempts=$((attempts + 1))
  if [[ $attempts -ge 24 ]]; then
    echo "Error: session did not become ACTIVE (state: $state)" >&2
    exit 1
  fi
done

TUNNEL_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
echo "Opening tunnel on localhost:$TUNNEL_PORT -> $TARGET_IP:22..." >&2
ssh \
  -i "$BASTION_KEY" \
  -o StrictHostKeyChecking=no \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -N -f \
  -L "${TUNNEL_PORT}:${TARGET_IP}:22" \
  "${SESSION_ID}@${BASTION_HOST}"

TUNNEL_PID=$(pgrep -n -f "ssh.*${TUNNEL_PORT}:${TARGET_IP}:22")

echo "Waiting for tunnel to be ready..." >&2
i=0
while ! ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
    -o ConnectTimeout=3 -p "$TUNNEL_PORT" "$REMOTE_USER@localhost" true 2>/dev/null; do
  sleep 1
  i=$((i+1))
  if [[ $i -ge 15 ]]; then
    echo "Error: tunnel did not become ready" >&2
    exit 1
  fi
done

echo "Connected. Type 'exit' to close the session." >&2
ssh \
  -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  -p "$TUNNEL_PORT" \
  "$REMOTE_USER@localhost"
