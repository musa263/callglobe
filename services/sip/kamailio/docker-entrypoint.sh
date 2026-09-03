#!/bin/sh
set -e
mkdir -p /var/lib/kamailio
if [ ! -f /var/lib/kamailio/usrloc.db ]; then
  if ! command -v sqlite3 >/dev/null 2>&1; then
    apk add --no-cache sqlite >/dev/null
  fi
  sqlite3 /var/lib/kamailio/usrloc.db < /etc/kamailio/usrloc-init.sql
fi

# The carrier's signalling addresses, rendered into a config the main file
# includes. Kamailio's =~ wants a literal, and an unauthenticated E.164 INVITE
# is exactly what toll fraud looks like — so the allowed sources are written
# out explicitly rather than matched against a pattern at run time.
#
# VOCIVO_TRUNK_SOURCES is a comma- or space-separated list of IPv4 addresses.
# Empty means no source is trusted, which is the safe default: inbound over the
# trunk stays refused until somebody names the addresses it may arrive from.
sources_file=/etc/kamailio/trunk-sources.cfg
{
  echo '# generated at container start from VOCIVO_TRUNK_SOURCES'
  echo 'route[TRUNK_SOURCE] {'
  echo '    $var(from_trunk) = 0;'
  printf '%s' "${VOCIVO_TRUNK_SOURCES:-}" | tr ', ' '\n\n' | while read -r address; do
    [ -n "$address" ] || continue
    case "$address" in
      *[!0-9.]*) echo "# ignored, not an IPv4 address: $address" >&2; continue;;
    esac
    printf '    if ($si == "%s") { $var(from_trunk) = 1; }\n' "$address"
  done
  echo '}'
} > "$sources_file"
# grep -c prints 0 and exits 1 when it matches nothing; || true keeps that from
# ending the script and from printing the count twice.
echo "kamailio: trunk sources -> $(grep -c 'from_trunk) = 1' "$sources_file" || true) address(es)"

exec kamailio -DD -E
