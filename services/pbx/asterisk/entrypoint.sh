#!/bin/sh
set -eu

for file in pjsip.conf extensions.conf; do
  envsubst < "/opt/vocivo/config/$file" > "/etc/asterisk/$file"
done
cp /opt/vocivo/config/rtp.conf /opt/vocivo/config/voicemail.conf /opt/vocivo/config/queues.conf /etc/asterisk/

exec /usr/sbin/asterisk -f -U asterisk -G asterisk -vvv
