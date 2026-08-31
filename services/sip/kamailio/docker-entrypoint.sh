#!/bin/sh
set -e
mkdir -p /var/lib/kamailio
if [ ! -f /var/lib/kamailio/usrloc.db ]; then
  if ! command -v sqlite3 >/dev/null 2>&1; then
    apk add --no-cache sqlite >/dev/null
  fi
  sqlite3 /var/lib/kamailio/usrloc.db < /etc/kamailio/usrloc-init.sql
fi
exec kamailio -DD -E
