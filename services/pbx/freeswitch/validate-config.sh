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

if ! grep -Fq 'value="http://127.0.0.1:8088/dialplan" bindings="dialplan"' "$root/config/autoload_configs/xml_curl.conf.xml" \
  || ! grep -Fq 'freeswitch/config/dialplan/default/vocivo.xml:/run/vocivo/dialplan/vocivo.xml:ro' "$root/../docker-compose.yml"; then
  echo "Tenant DID routing must use the signed local dialplan service." >&2
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

if ! grep -Fq 'rtp_adv_audio_ip=@@PBX_PUBLIC_IP@@' "$root/config/dialplan/default/vocivo.xml"; then
  echo "WebRTC dialplans must advertise the PBX public media address." >&2
  exit 1
fi

if grep -Fq 'vocivo_organization_id=primary' "$root/config/dialplan/public/vocivo-inbound.xml" \
  || grep -Fq 'PBX_DEFAULT_EXTENSION' "$root/config/dialplan/public/vocivo-inbound.xml"; then
  echo "Public inbound calls must not fall back to the primary tenant or default extension." >&2
  exit 1
fi

if ! grep -Fq '{ignore_early_media=true,originate_timeout=35}[leg_timeout=35]user/$1' "$root/config/dialplan/default/vocivo.xml" \
  || ! grep -Fq 'bridge_answer_timeout=35' "$root/config/dialplan/default/vocivo.xml" \
  || ! grep -Fq 'continue_on_fail=NO_ANSWER,USER_NOT_REGISTERED,SUBSCRIBER_ABSENT' "$root/config/dialplan/default/vocivo.xml"; then
  echo "Internal extension bridges must enforce a bounded no-answer timeout." >&2
  exit 1
fi

if ! grep -Fq 'apply-candidate-acl" value="any_v4.auto' "$root/config/sip_profiles/vocivo-internal.xml"; then
  echo "WebRTC endpoints must accept valid public and relay ICE candidates." >&2
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

if sed -n '/^[[:space:]]*caddy:/,/^[[:space:]]*edge-router:/p' "$root/../docker-compose.yml" | grep -q 'network_mode: host' \
  || sed -n '/^[[:space:]]*caddy:/,/^[[:space:]]*edge-router:/p' "$root/../docker-compose.yml" | grep -Fq '"443:443"' \
  || ! sed -n '/^[[:space:]]*edge-router:/,/^[[:space:]]*volumes:/p' "$root/../docker-compose.yml" | grep -Fq '"443:443"'; then
  echo "The TLS edge must own public port 443 and route WSS to isolated Caddy." >&2
  exit 1
fi

if find "$root/.." -type f -path '*/asterisk/*' | grep -q . \
  || grep -Rqi 'legacy-asterisk' "$root/../docker-compose.yml" "$root/../digitalocean" "$root/../README.md"; then
  echo "Legacy Asterisk configuration must not remain in the FreeSWITCH deployment." >&2
  exit 1
fi

if ! grep -Fq 'subnet: 172.30.0.0/24' "$root/../docker-compose.yml" \
  || ! grep -Fq "ufw allow from 172.30.0.0/24 to any port 5066 proto tcp" "$root/../digitalocean/bootstrap-host.sh" \
  || ! grep -Fq "ufw allow from 172.30.0.0/24 to any port 5349 proto tcp" "$root/../digitalocean/bootstrap-host.sh"; then
  echo "The isolated TLS subnet must be allowlisted only to Sofia WS and TURN TLS." >&2
  exit 1
fi

if ! grep -Fq -- '--use-auth-secret' "$root/../docker-compose.yml" \
  || ! grep -Fq 'turn_auth_secret' "$root/../docker-compose.yml" \
  || grep -Fq -- '--user=${TURN_USERNAME}:${TURN_PASSWORD}' "$root/../docker-compose.yml" \
  || ! grep -Fq 'turn-tls if { req_ssl_sni -i @@TURN_TLS_DOMAIN@@ }' "$root/../haproxy/haproxy.cfg.template"; then
  echo "TURN must use short-lived REST credentials and the TLS 443 fallback." >&2
  exit 1
fi

if ! grep -Fq 'admin off' "$root/../caddy/Caddyfile" \
  || [ "$(grep -Fc 'import production_tls' "$root/../caddy/Caddyfile")" -ne 3 ] \
  || ! grep -Fq 'disable_tlsalpn_challenge' "$root/../caddy/Caddyfile"; then
  echo "Every public PBX hostname must use the hardened ACME TLS policy." >&2
  exit 1
fi

production_env="$root/../.env.production.example"
if [ "$(grep -Ec '^APNS_ENABLED=true$|^FCM_ENABLED=true$' "$production_env")" -ne 2 ] \
  || ! grep -Fq 'TURN_REALM=turn.68.183.244.215.nip.io' "$production_env" \
  || ! grep -Fq 'TURN_TLS_DOMAIN=turn.68.183.244.215.nip.io' "$production_env" \
  || grep -Eq '^TURN_(USERNAME|PASSWORD)=' "$production_env"; then
  echo "Production push and temporary TURN settings are inconsistent." >&2
  exit 1
fi

deploy_script="$root/../../../deploy-production.sh"
if [ ! -x "$deploy_script" ] \
  || ! grep -Fq 'git pull --ff-only' "$deploy_script" \
  || ! grep -Fq 'validate-production-env.sh' "$deploy_script" \
  || [ ! -x "$root/../digitalocean/validate-production-env.sh" ]; then
  echo "The production deployment preflight is missing or not executable." >&2
  exit 1
fi

if ! grep -Fq 'vocivo-${vocivo_sip_domain}-$1@default' "$root/config/dialplan/default/vocivo.xml"; then
  echo "Conference rooms must be namespaced to the tenant SIP domain." >&2
  exit 1
fi

echo "FreeSWITCH XML templates are well formed."
