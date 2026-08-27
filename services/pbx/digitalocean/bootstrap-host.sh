#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git rsync ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

cat >/etc/sysctl.d/99-vocivo-pbx.conf <<'EOF'
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.netdev_max_backlog=5000
net.netfilter.nf_conntrack_max=262144
net.ipv4.ip_local_port_range=10240 65535
fs.file-max=1000000
EOF
sysctl --system

# The $12 pilot Droplet has 2 GB RAM. Swap prevents the one-time FreeSWITCH
# source build from being killed while leaving normal voice media in RAM.
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'ACME HTTP challenge'
ufw allow 443/tcp comment 'WebRTC WSS'
for carrier_cidr in ${CARRIER_CIDRS:-}; do
  ufw allow from "$carrier_cidr" to any port 5060 proto tcp comment 'Carrier SIP TCP'
  ufw allow from "$carrier_cidr" to any port 5060 proto udp comment 'Carrier SIP UDP'
done
ufw allow 20000:29999/udp comment 'FreeSWITCH RTP'
ufw --force enable

mkdir -p /opt/vocivo-pbx
chmod 750 /opt/vocivo-pbx
systemctl enable --now docker

if [ -z "${CARRIER_CIDRS:-}" ]; then
  echo "No carrier signaling CIDRs were supplied. SIP 5060 remains blocked until the carrier addresses are allowlisted."
fi
echo "Vocivo PBX host bootstrap complete. ESL 8021, health 8088, SIP WS 5066 and Verto 8081 remain private."
