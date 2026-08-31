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
exec /usr/bin/freeswitch -nc -nf -nonat
