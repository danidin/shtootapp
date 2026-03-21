#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOSTS_FILE="$SCRIPT_DIR/hosts.conf"
SSH_KEY="$HOME/.ssh/oci-key"         # VM access key
BASTION_KEY="$HOME/.ssh/bastion-key" # Bastion session key
REMOTE_USER="ubuntu"
SESSION_TTL=1800  # 30 minutes

# Load hosts
if [[ ! -f "$HOSTS_FILE" ]]; then
  echo "Error: $HOSTS_FILE not found" >&2
  exit 1
fi
source "$HOSTS_FILE"

: "${BASTION_OCID:?BASTION_OCID not set in hosts.conf}"
: "${OCI_REGION:?OCI_REGION not set in hosts.conf}"
: "${OZEN_IP:?OZEN_IP not set in hosts.conf}"
: "${PARTZOOF_IP:?PARTZOOF_IP not set in hosts.conf}"

BASTION_HOST="host.bastion.${OCI_REGION}.oci.oraclecloud.com"
SESSIONS=()
SESSION_ID=""
TUNNEL_PID=""
TUNNEL_PORT=""

cleanup() {
  if [[ -n "$TUNNEL_PID" ]]; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    TUNNEL_PID=""
  fi
  if [[ ${#SESSIONS[@]} -gt 0 ]]; then
    for session in "${SESSIONS[@]}"; do
      echo "  Deleting bastion session $session..." >&2
      "$SCRIPT_DIR/oci_create_session.py" delete "$session" || true
    done
    SESSIONS=()
  fi
}
trap cleanup EXIT

# Sets SESSION_ID to the new active session OCID (avoids subshell so SESSIONS array is updated)
create_session() {
  local target_ip=$1
  local label=$2

  echo "  Creating bastion session for $label ($target_ip)..." >&2

  SESSION_ID=$("$SCRIPT_DIR/oci_create_session.py" create "$BASTION_OCID" "$target_ip" "$label") \
    || { echo "Error: OCI session create failed" >&2; exit 1; }

  if [[ -z "$SESSION_ID" ]]; then
    echo "Error: empty session OCID returned" >&2
    exit 1
  fi

  SESSIONS+=("$SESSION_ID")
  echo "  Session OCID: $SESSION_ID" >&2

  echo "  Waiting for session to become ACTIVE..." >&2
  local state attempts=0
  while true; do
    sleep 5
    state=$("$SCRIPT_DIR/oci_create_session.py" get "$SESSION_ID")
    if [[ "$state" == "ACTIVE" ]]; then
      sleep 10  # give OCI time to provision the SSH endpoint
      break
    fi
    attempts=$((attempts + 1))
    if [[ $attempts -ge 24 ]]; then
      echo "Error: session did not become ACTIVE in time (state: $state)" >&2
      exit 1
    fi
  done
}

# Open a local SSH tunnel through the bastion to the target VM.
# Sets TUNNEL_PORT to the local port.
open_tunnel() {
  local session_ocid=$1
  local target_ip=$2

  # Pick a random free port
  TUNNEL_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')

  echo "  Opening tunnel on localhost:$TUNNEL_PORT -> $target_ip:22..." >&2
  ssh \
    -i "$BASTION_KEY" \
    -o StrictHostKeyChecking=no \
    -o IdentitiesOnly=yes \
    -o ExitOnForwardFailure=yes \
    -N -f \
    -L "${TUNNEL_PORT}:${target_ip}:22" \
    "${session_ocid}@${BASTION_HOST}"

  TUNNEL_PID=$(pgrep -n -f "ssh.*${TUNNEL_PORT}:${target_ip}:22")

  # Wait for tunnel to be ready
  local i=0
  while ! ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
      -o ConnectTimeout=3 -p "$TUNNEL_PORT" "$REMOTE_USER@localhost" true 2>/dev/null; do
    sleep 1
    i=$((i+1))
    if [[ $i -ge 15 ]]; then
      echo "Error: tunnel did not become ready" >&2
      exit 1
    fi
  done
  echo "  Tunnel ready." >&2
}

close_tunnel() {
  if [[ -n "$TUNNEL_PID" ]]; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    TUNNEL_PID=""
  fi
}

ssh_vm() {
  ssh \
    -i "$SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o BatchMode=yes \
    -p "$TUNNEL_PORT" \
    "$REMOTE_USER@localhost" "$@"
}


TARGET="${1:-all}"

deploy_ozen() {
  echo "==> Deploying ozen..."
  create_session "$OZEN_IP" "ozen"
  open_tunnel "$SESSION_ID" "$OZEN_IP"

  ssh_vm "mkdir -p ~/ozen"
  tar -czf - -C "$SCRIPT_DIR/ozen" \
    --exclude=node_modules \
    --exclude='.git' \
    . | ssh \
      -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -p "$TUNNEL_PORT" \
      "$REMOTE_USER@localhost" \
      "cd ~/ozen && tar -xzf -"
  ssh_vm "cd ~/ozen && sudo docker compose stop ozen && sudo docker compose up -d --build ozen"

  close_tunnel
  echo "==> ozen deployed."
}

deploy_partzoof() {
  echo "==> Deploying partzoof..."
  create_session "$PARTZOOF_IP" "partzoof"
  open_tunnel "$SESSION_ID" "$PARTZOOF_IP"

  ssh_vm "mkdir -p ~/partzoof"
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -P "$TUNNEL_PORT" \
    "$SCRIPT_DIR/partzoof/docker-compose.yml" "$REMOTE_USER@localhost:~/partzoof/docker-compose.yml"
  ssh_vm "cd ~/partzoof && sudo docker compose stop && sudo docker compose up -d"

  close_tunnel
  echo "==> partzoof deployed."
}

case "$TARGET" in
  ozen)      deploy_ozen ;;
  partzoof)  deploy_partzoof ;;
  all)       deploy_partzoof && deploy_ozen ;;
  *)
    echo "Usage: $0 [ozen|partzoof|all]"
    exit 1
    ;;
esac
