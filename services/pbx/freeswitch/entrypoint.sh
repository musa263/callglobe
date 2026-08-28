#!/bin/sh
set -eu

conf=/usr/local/freeswitch/etc/freeswitch
templates=/opt/vocivo/config

required() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

safe_value() {
  name="$1"
  eval "value=\${$name:-}"
  case "$value" in
    *'|'*|*'&'*|*'<'*|*'>'*|*'"'*|*"'"*|*'\n'*|*'\r'*)
      echo "$name contains unsupported characters." >&2
      exit 1
      ;;
  esac
}

render() {
  source="$1"
  target="$2"
  mkdir -p "$(dirname "$target")"
  sed \
    -e "s|@@PBX_PUBLIC_IP@@|$PBX_PUBLIC_IP|g" \
    -e "s|@@PBX_CARRIER_BIND_IP@@|$PBX_CARRIER_BIND_IP|g" \
    -e "s|@@PBX_SIP_DOMAIN@@|$PBX_SIP_DOMAIN|g" \
    -e "s|@@PBX_DEFAULT_EXTENSION@@|$PBX_DEFAULT_EXTENSION|g" \
    -e "s|@@PBX_DEFAULT_EXTENSION_NAME@@|$PBX_DEFAULT_EXTENSION_NAME|g" \
    -e "s|@@PBX_DEFAULT_EXTENSION_PASSWORD@@|$PBX_DEFAULT_EXTENSION_PASSWORD|g" \
    -e "s|@@PBX_RTP_START@@|$PBX_RTP_START|g" \
    -e "s|@@PBX_RTP_END@@|$PBX_RTP_END|g" \
    -e "s|@@PBX_MAX_SESSIONS@@|$PBX_MAX_SESSIONS|g" \
    -e "s|@@PBX_SESSIONS_PER_SECOND@@|$PBX_SESSIONS_PER_SECOND|g" \
    -e "s|@@ESL_PASSWORD@@|$ESL_PASSWORD|g" \
    -e "s|@@PSTN_GATEWAY_NAME@@|$PSTN_GATEWAY_NAME|g" \
    -e "s|@@PSTN_SIP_PROXY@@|$PSTN_SIP_PROXY|g" \
    -e "s|@@PSTN_SIP_PORT@@|$PSTN_SIP_PORT|g" \
    -e "s|@@PSTN_SIP_USERNAME@@|$PSTN_SIP_USERNAME|g" \
    -e "s|@@PSTN_SIP_PASSWORD@@|$PSTN_SIP_PASSWORD|g" \
    -e "s|@@PSTN_OUTBOUND_CALLER_ID@@|$PSTN_OUTBOUND_CALLER_ID|g" \
    -e "s|@@PSTN_REGISTER@@|$PSTN_REGISTER|g" \
    -e "s|@@PSTN_PING_INTERVAL@@|$PSTN_PING_INTERVAL|g" \
    "$source" > "$target"
}

for variable in PBX_PUBLIC_IP PBX_CARRIER_BIND_IP PBX_SIP_DOMAIN PBX_DEFAULT_EXTENSION \
  PBX_DEFAULT_EXTENSION_PASSWORD ESL_PASSWORD PSTN_GATEWAY_NAME \
  PSTN_SIP_PROXY PSTN_SIP_PORT PSTN_SIP_USERNAME PSTN_SIP_PASSWORD \
  PSTN_OUTBOUND_CALLER_ID; do
  required "$variable"
  safe_value "$variable"
done

PBX_DEFAULT_EXTENSION_NAME=${PBX_DEFAULT_EXTENSION_NAME:-Vocivo Administrator}
PBX_RTP_START=${PBX_RTP_START:-20000}
PBX_RTP_END=${PBX_RTP_END:-29999}
PBX_MAX_SESSIONS=${PBX_MAX_SESSIONS:-50}
PBX_SESSIONS_PER_SECOND=${PBX_SESSIONS_PER_SECOND:-10}
PSTN_REGISTER=${PSTN_REGISTER:-true}
safe_value PBX_DEFAULT_EXTENSION_NAME

case "$PSTN_REGISTER" in
  true) PSTN_PING_INTERVAL=25 ;;
  false) PSTN_PING_INTERVAL=0 ;;
  *) echo "PSTN_REGISTER must be true or false." >&2; exit 1 ;;
esac

case "$PBX_PUBLIC_IP" in
  *[!0-9a-fA-F.:]*) echo "PBX_PUBLIC_IP must be an IPv4 or IPv6 address." >&2; exit 1 ;;
esac
case "$PBX_CARRIER_BIND_IP" in
  *[!0-9a-fA-F.:]*) echo "PBX_CARRIER_BIND_IP must be an IPv4 or IPv6 address." >&2; exit 1 ;;
esac
case "$PBX_DEFAULT_EXTENSION" in
  *[!0-9]*|'') echo "PBX_DEFAULT_EXTENSION must contain digits only." >&2; exit 1 ;;
esac
case "$PBX_RTP_START:$PBX_RTP_END" in
  *[!0-9:]*) echo "PBX RTP ports must be numeric." >&2; exit 1 ;;
esac
case "$PBX_MAX_SESSIONS:$PBX_SESSIONS_PER_SECOND" in
  *[!0-9:]*) echo "PBX session limits must be numeric." >&2; exit 1 ;;
esac
if [ "$PBX_MAX_SESSIONS" -lt 1 ] || [ "$PBX_MAX_SESSIONS" -gt 5000 ]; then
  echo "PBX_MAX_SESSIONS must be between 1 and 5000." >&2
  exit 1
fi
if [ "$PBX_SESSIONS_PER_SECOND" -lt 1 ] || [ "$PBX_SESSIONS_PER_SECOND" -gt 1000 ]; then
  echo "PBX_SESSIONS_PER_SECOND must be between 1 and 1000." >&2
  exit 1
fi

# Remove the public demonstration users and routes from the vanilla install.
find "$conf/directory/default" -mindepth 1 -maxdepth 1 -type f -delete
find "$conf/dialplan/default" -mindepth 1 -maxdepth 1 -type f -delete
find "$conf/dialplan/public" -mindepth 1 -maxdepth 1 -type f -delete
find "$conf/sip_profiles" -mindepth 1 -maxdepth 1 -type f -delete
rm -rf "$conf/sip_profiles/internal" "$conf/sip_profiles/external"

render "$templates/autoload_configs/event_socket.conf.xml" "$conf/autoload_configs/event_socket.conf.xml"
render "$templates/autoload_configs/switch.conf.xml" "$conf/autoload_configs/switch.conf.xml"
render "$templates/autoload_configs/verto.conf.xml" "$conf/autoload_configs/verto.conf.xml"
render "$templates/autoload_configs/xml_curl.conf.xml" "$conf/autoload_configs/xml_curl.conf.xml"
render "$templates/sip_profiles/vocivo-internal.xml" "$conf/sip_profiles/vocivo-internal.xml"
render "$templates/sip_profiles/vocivo-external.xml" "$conf/sip_profiles/vocivo-external.xml"
# mod_xml_curl is authoritative for tenant users. Keep static bootstrap disabled.
# These templates contain complete contexts. Install them at the dialplan root;
# the default/ and public/ directories accept extension fragments only.
render "$templates/dialplan/default/vocivo.xml" "$conf/dialplan/vocivo-internal.xml"
render "$templates/dialplan/public/vocivo-inbound.xml" "$conf/dialplan/vocivo-public.xml"

for module in mod_xml_curl mod_sofia mod_verto mod_event_socket mod_conference mod_voicemail mod_opus; do
  if ! grep -Eq "^[[:space:]]*<load[[:space:]]+module=\"$module\"[[:space:]]*/>" "$conf/autoload_configs/modules.conf.xml"; then
    sed -i "s|</modules>|    <load module=\"$module\"/>\n  </modules>|" "$conf/autoload_configs/modules.conf.xml"
  fi
done

# The pilot uses its own ESL and API control plane, not the vanilla connectors.
sed -i '/module="mod_signalwire"/d; /module="mod_xml_rpc"/d' "$conf/autoload_configs/modules.conf.xml"

# FreeSWITCH generates its 4096-bit WebRTC DTLS certificate on first start.
# The certificate must survive container replacement and be writable after
# FreeSWITCH drops privileges, otherwise SDP contains an empty fingerprint.
mkdir -p "$conf/tls"
chown -R freeswitch:freeswitch \
  "$conf/tls" \
  /usr/local/freeswitch/var/lib/freeswitch \
  /usr/local/freeswitch/var/log/freeswitch \
  /usr/local/freeswitch/var/run/freeswitch \
  /usr/local/freeswitch/share/freeswitch/sounds \
  /var/lib/vocivo/recordings
chmod 700 "$conf/tls"
exec /usr/local/freeswitch/bin/freeswitch -u freeswitch -g freeswitch -nf -nonat
