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
# VOCIVO_TRUNK_SOURCES is a comma- or space-separated list of IPv4 addresses
# and CIDR ranges.
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
      # A range, which is what carriers actually publish: Telnyx's signalling
      # is 192.76.120.128/26 and friends, never a list of single hosts.
      *[0-9].[0-9]*/[0-9]*)
        printf '    if (is_ip_in_subnet($si, "%s")) { $var(from_trunk) = 1; }\n' "$address"
        ;;
      *[!0-9.]*)
        echo "kamailio: ignoring trunk source, not an address or range: $address" >&2
        ;;
      *)
        printf '    if ($si == "%s") { $var(from_trunk) = 1; }\n' "$address"
        ;;
    esac
  done
  echo '}'
} > "$sources_file"
# grep -c prints 0 and exits 1 when it matches nothing; || true keeps that from
# ending the script and from printing the count twice.
echo "kamailio: trunk sources -> $(grep -c 'from_trunk) = 1' "$sources_file" || true) entr(ies)"

exec kamailio -DD -E
