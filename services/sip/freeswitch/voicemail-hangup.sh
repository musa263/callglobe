#!/bin/sh
# Pushes a voicemail recording to the Vocivo API once the caller has hung up.
#
# Invoked from FreeSWITCH's api_hangup_hook, because the caller hanging up is
# how a voicemail normally ends and a hung-up channel runs no more dialplan:
# an upload written as the next action after `record` never happened at all.
#
# The URL is signed by the API for this one call and expires within the hour,
# so it carries its own authorisation and this script holds no secret.
url="$1"
recording="$2"
if [ -z "$url" ] || [ -z "$recording" ] || [ ! -s "$recording" ]; then
  # No recording is the ordinary case for a caller who hung up during the
  # greeting. Nothing to send, nothing to clean up.
  exit 0
fi
if curl -sS -f -m 30 -X PUT \
    -H "Content-Type: audio/wav" \
    --data-binary "@$recording" \
    "$url" >/dev/null 2>&1; then
  rm -f "$recording"
else
  # Kept on disk so the failure can be seen, and named so a later run can tell
  # it apart from a recording still being written.
  echo "vocivo: voicemail upload failed for $recording" >&2
  mv -f "$recording" "$recording.failed" 2>/dev/null || true
fi
