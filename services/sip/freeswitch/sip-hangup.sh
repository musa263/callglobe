#!/bin/sh
# Invoked from FreeSWITCH api_hangup_hook with session variables expanded.
route_id="$1"
event_id="$2"
seconds="$3"
if [ -z "$route_id" ] || [ -z "$VOCIVO_API_URL" ] || [ -z "$SIP_EDGE_SECRET" ]; then
  exit 0
fi
curl -sS -m 8 -X POST "$VOCIVO_API_URL/api/voice/sip-hangup" \
  -H "Authorization: Bearer $SIP_EDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"routeId\":\"$route_id\",\"eventId\":\"${event_id:-hangup}\",\"durationSeconds\":${seconds:-0}}" \
  >/dev/null 2>&1 || true
