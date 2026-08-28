#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT INT TERM

find "$root/config" -type f -name '*.xml' | while IFS= read -r source; do
  target="$temporary/$(basename "$source")"
  sed \
    -e 's|@@PBX_PUBLIC_IP@@|203.0.113.10|g' \
    -e 's|@@PBX_CARRIER_BIND_IP@@|10.0.0.2|g' \
    -e 's|@@PBX_SIP_DOMAIN@@|sip.example.com|g' \
    -e 's|@@PBX_DEFAULT_EXTENSION@@|2000|g' \
    -e 's|@@PBX_DEFAULT_EXTENSION_NAME@@|Vocivo Administrator|g' \
    -e 's|@@PBX_DEFAULT_EXTENSION_PASSWORD@@|test-password-123|g' \
    -e 's|@@PBX_RTP_START@@|20000|g' \
    -e 's|@@PBX_RTP_END@@|29999|g' \
    -e 's|@@PBX_MAX_SESSIONS@@|50|g' \
    -e 's|@@PBX_SESSIONS_PER_SECOND@@|10|g' \
    -e 's|@@ESL_PASSWORD@@|test-esl-password-123|g' \
    -e 's|@@PSTN_GATEWAY_NAME@@|carrier|g' \
    -e 's|@@PSTN_SIP_PROXY@@|sip.carrier.example|g' \
    -e 's|@@PSTN_SIP_PORT@@|5060|g' \
    -e 's|@@PSTN_SIP_USERNAME@@|test-user|g' \
    -e 's|@@PSTN_SIP_PASSWORD@@|test-password|g' \
    -e 's|@@PSTN_OUTBOUND_CALLER_ID@@|+15551234567|g' \
    -e 's|@@PSTN_REGISTER@@|true|g' \
    -e 's|@@PSTN_PING_INTERVAL@@|25|g' \
    "$source" > "$target"
  if grep -q '@@[A-Z_]*@@' "$target"; then
    echo "Unresolved placeholder in $source" >&2
    exit 1
  fi
  xmllint --noout "$target"
done

if ! grep -q '<param name="method" value="POST"/>' "$root/config/autoload_configs/xml_curl.conf.xml"; then
  echo "FreeSWITCH XML-curl must use uppercase POST for Node HTTP compatibility." >&2
  exit 1
fi

if ! grep -Fq '"$conf/dialplan/vocivo-internal.xml"' "$root/entrypoint.sh" \
  || ! grep -Fq '"$conf/dialplan/vocivo-public.xml"' "$root/entrypoint.sh"; then
  echo "Complete Vocivo dialplan contexts must be installed at the dialplan root." >&2
  exit 1
fi

if ! grep -Fq '"$conf/tls"' "$root/entrypoint.sh" \
  || ! grep -Fq 'freeswitch-certs:/usr/local/freeswitch/etc/freeswitch/tls' "$root/../docker-compose.yml"; then
  echo "WebRTC DTLS certificates must use a persistent, writable volume." >&2
  exit 1
fi

if ! grep -Fq 'rtp_adv_audio_ip=@@PBX_PUBLIC_IP@@' "$root/config/dialplan/default/vocivo.xml" \
  || ! grep -Fq 'rtp_adv_audio_ip=@@PBX_PUBLIC_IP@@' "$root/config/dialplan/public/vocivo-inbound.xml"; then
  echo "WebRTC dialplans must advertise the PBX public media address." >&2
  exit 1
fi

if ! grep -Fq '{originate_timeout=35,leg_timeout=35}user/$1' "$root/config/dialplan/default/vocivo.xml" \
  || ! grep -Fq 'bridge_answer_timeout=35' "$root/config/dialplan/default/vocivo.xml" \
  || ! grep -Fq 'continue_on_answer_timeout=true' "$root/config/dialplan/default/vocivo.xml"; then
  echo "Internal extension bridges must enforce a bounded no-answer timeout." >&2
  exit 1
fi

if ! grep -Fq '<param name="ws-binding" value="@@PBX_CARRIER_BIND_IP@@:5066"/>' "$root/config/sip_profiles/vocivo-internal.xml" \
  || ! grep -Fq '<param name="local-network-acl" value="none"/>' "$root/config/sip_profiles/vocivo-internal.xml" \
  || ! grep -Fq '<param name="multiple-registrations" value="call-id"/>' "$root/config/sip_profiles/vocivo-internal.xml" \
  || ! grep -Fq 'reverse_proxy {$PBX_CARRIER_BIND_IP}:5066' "$root/../caddy/Caddyfile"; then
  echo "The WSS proxy hop must allow Sofia to apply the external RTP address." >&2
  exit 1
fi

if ! grep -Fq -- '- ./caddy:/etc/caddy:ro' "$root/../docker-compose.yml" \
  || ! grep -Fq 'docker compose up -d --force-recreate caddy' "$root/../digitalocean/deploy.sh"; then
  echo "Caddy must remount and reload its synchronized configuration." >&2
  exit 1
fi

if sed -n '/^[[:space:]]*caddy:/,/^[[:space:]]*asterisk:/p' "$root/../docker-compose.yml" | grep -q 'network_mode: host' \
  || ! sed -n '/^[[:space:]]*caddy:/,/^[[:space:]]*asterisk:/p' "$root/../docker-compose.yml" | grep -Fq '"443:443"'; then
  echo "Caddy must use an isolated network namespace while publishing WSS on 443." >&2
  exit 1
fi

if ! grep -Fq 'subnet: 172.30.0.0/24' "$root/../docker-compose.yml" \
  || ! grep -Fq "ufw allow from 172.30.0.0/24 to any port 5066 proto tcp" "$root/../digitalocean/bootstrap-host.sh"; then
  echo "The isolated Caddy subnet must be allowlisted only to Sofia WS." >&2
  exit 1
fi

echo "FreeSWITCH XML templates are well formed."
