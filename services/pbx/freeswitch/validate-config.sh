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

echo "FreeSWITCH XML templates are well formed."
