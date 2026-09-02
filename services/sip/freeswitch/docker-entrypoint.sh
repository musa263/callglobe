#!/bin/sh
set -e
if [ ! -f /etc/freeswitch/freeswitch.xml ]; then
  mkdir -p /etc/freeswitch
  cp -a /usr/share/freeswitch/conf/vanilla/. /etc/freeswitch/
fi
mkdir -p /etc/freeswitch/autoload_configs /etc/freeswitch/sip_profiles /etc/freeswitch/dialplan /etc/freeswitch/directory
cp /opt/vocivo-fs/autoload_configs/switch.conf.xml /etc/freeswitch/autoload_configs/switch.conf.xml
cp /opt/vocivo-fs/sip_profiles/external.xml /etc/freeswitch/sip_profiles/external.xml
cp /opt/vocivo-fs/sip_profiles/internal.xml /etc/freeswitch/sip_profiles/internal.xml
cp /opt/vocivo-fs/dialplan/public.xml /etc/freeswitch/dialplan/public.xml
cp /opt/vocivo-fs/dialplan/default.xml /etc/freeswitch/dialplan/default.xml
cp /opt/vocivo-fs/directory/default.xml /etc/freeswitch/directory/default.xml
PUBLIC_IP_REGEX=$(printf '%s' "${PUBLIC_IP:-127.0.0.1}" | sed 's/\./\\./g')
sed -i \
  -e 's#$${TELNYX_SIP_HOST}#'"${TELNYX_SIP_HOST:-sip.telnyx.com}"'#g' \
  -e 's#$${TELNYX_SIP_REALM}#'"${TELNYX_SIP_REALM:-sip.telnyx.com}"'#g' \
  -e 's#$${TELNYX_SIP_USERNAME}#'"${TELNYX_SIP_USERNAME:-}"'#g' \
  -e 's#$${TELNYX_SIP_PASSWORD}#'"${TELNYX_SIP_PASSWORD:-}"'#g' \
  -e 's#$${PUBLIC_IP}#'"${PUBLIC_IP:-127.0.0.1}"'#g' \
  /etc/freeswitch/sip_profiles/external.xml
sed -i -e 's#PUBLIC_IP_REGEX#'"${PUBLIC_IP_REGEX}"'#g' /etc/freeswitch/dialplan/public.xml

# Ensure a module is loaded exactly once. Vanilla modules.conf.xml ships these
# commented out; inserting after <modules> keeps mod_xml_curl ahead of any
# dialplan lookup and is idempotent across restarts.
MODULES_CONF=/etc/freeswitch/autoload_configs/modules.conf.xml
enable_module() {
  if ! grep -Eq "^[[:space:]]*<load module=\"$1\"/>" "$MODULES_CONF"; then
    sed -i -e "0,/<modules>/s#<modules>#<modules>\n    <load module=\"$1\"/>#" "$MODULES_CONF"
  fi
}
# Prompts stream from the Vocivo API (http_cache://) and may be mp3 (mod_shout)
# or wav; voicemail recordings are pushed back with http_put (mod_http_cache).
enable_module mod_http_cache
enable_module mod_shout

RECORDINGS_DIR="${VOCIVO_SIP_RECORDINGS_DIR:-/var/lib/vocivo/recordings}"
mkdir -p "$RECORDINGS_DIR"

if [ "${VOCIVO_SIP_INBOUND:-0}" = "1" ]; then
  : "${SIP_EDGE_SECRET:?SIP_EDGE_SECRET is required for the inbound dialplan binding}"
  cp /opt/vocivo-fs/autoload_configs/xml_curl.conf.xml /etc/freeswitch/autoload_configs/xml_curl.conf.xml
  sed -i \
    -e 's#$${VOCIVO_API_URL}#'"${VOCIVO_API_URL:-https://vocivo.app}"'#g' \
    -e 's#$${SIP_EDGE_SECRET}#'"${SIP_EDGE_SECRET}"'#g' \
    /etc/freeswitch/autoload_configs/xml_curl.conf.xml
  enable_module mod_xml_curl
  echo "Vocivo: inbound DIDs are routed by the Vocivo API dialplan (VOCIVO_SIP_INBOUND=1)."
else
  # No binding at all while the flag is off, so ordinary calls never wait on an API round trip.
  rm -f /etc/freeswitch/autoload_configs/xml_curl.conf.xml
  sed -i -e '/^[[:space:]]*<load module="mod_xml_curl"\/>[[:space:]]*$/d' "$MODULES_CONF"
  echo "Vocivo: inbound DIDs stay on Telnyx Call Control (VOCIVO_SIP_INBOUND=0)."
fi

exec /usr/bin/freeswitch -nc -nf -nonat
