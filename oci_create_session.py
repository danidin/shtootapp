#!/home/danny/lib/oracle-cli/bin/python3
"""
Usage:
  create:  oci_create_session.py create <bastion_ocid> <target_ip> <label>
  get:     oci_create_session.py get <session_ocid>
  delete:  oci_create_session.py delete <session_ocid>
"""
import sys
import os
import oci

config = oci.config.from_file()
client = oci.bastion.BastionClient(config)

cmd = sys.argv[1]

if cmd == "create":
    bastion_id, target_ip, label = sys.argv[2], sys.argv[3], sys.argv[4]
    pub_key_path = os.path.expanduser("~/.ssh/bastion-key.pub")
    with open(pub_key_path) as f:
        pub_key = f.read().strip()
    resp = client.create_session(
        oci.bastion.models.CreateSessionDetails(
            bastion_id=bastion_id,
            display_name=f"deploy-{label}",
            session_ttl_in_seconds=1800,
            key_details=oci.bastion.models.PublicKeyDetails(public_key_content=pub_key),
            target_resource_details=oci.bastion.models.CreatePortForwardingSessionTargetResourceDetails(
                target_resource_private_ip_address=target_ip,
                target_resource_port=22,
            ),
        )
    )
    print(resp.data.id)

elif cmd == "get":
    session_id = sys.argv[2]
    resp = client.get_session(session_id)
    print(resp.data.lifecycle_state)

elif cmd == "delete":
    session_id = sys.argv[2]
    client.delete_session(session_id)
