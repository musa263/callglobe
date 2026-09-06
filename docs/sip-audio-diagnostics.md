# SIP and receptionist diagnostics

## Authentication

An initial 401 is the normal REGISTER challenge. The client uses SIP
credentials and `Authorization` in response to `WWW-Authenticate`. A proxy's
407 instead pairs `Proxy-Authenticate` with `Proxy-Authorization`; SIP.js
handles that distinction. API bearer credentials are not SIP passwords.

The deployed edge advertises MD5 with qop=auth. The API rejects unsupported
algorithms, duplicate fields, a different authentication scheme, invalid
nonce-count/client-nonce fields, expired nonces, and replayed responses. SHA-256
requires algorithm-specific stored HA1 values and client/edge negotiation;
it is not silently treated as MD5. A nonce-service outage returns 503 rather
than an unrelated challenge that the API can never validate.

For repeated failures, inspect `invalid_digest_header`,
`unsupported_digest_algorithm`, `stale_nonce`, `password_mismatch`, and
`replayed_digest` in the auth result. Do not log passwords or digest headers.

## Dead air and one-way audio

SIP mode requires `VOCIVO_TURN_URLS` and a matching `VOCIVO_TURN_SECRET` of at
least 32 characters. Configure the coturn shared secret to the same value.
Credential endpoints now report missing relay configuration rather than
returning an empty ICE list or borrowing Telnyx settings. Credentials remain
short-lived and scoped to the calling subject.

Check the selected ICE candidate pair, bidirectional RTP packet counters,
DTLS state, codec compatibility, and audio playback permissions. Verify that
the configured TURN listener and relay port range are reachable. STUN discovers
addresses; TURN relays media. SIP keepalives preserve signaling mappings and
cannot fix an unreachable media path. Private host candidates alone do not
prove a failure when ICE has selected a reachable pair.

## Receptionist response and interruption delay

See [receptionist configuration](../services/receptionist/README.md#speech-interruptions).
The ordinary end-of-turn default is one second. During greetings and normal
responses, the service observes inbound audio in 20 ms frames, preserves
pre-roll, cancels pending generation and playback when speech is detected,
and transcribes the interruption as the next turn. It does not execute the
interrupted model action. ESL has one stream reader and correlates application
completion by UUID, preventing stale playback events from completing a new
prompt.

Before deploying, run the receptionist tests and API checks. On the actual
edge, confirm `.r8` support, file visibility while recording, cancellation
during greeting/model generation/playback, no transfer after an interrupted
answer, quiet/noisy handset behavior, audio-file cleanup, and calls through
TURN from a separate network. Automated fixtures do not measure real RTP or
acoustic latency.

Protocol references: [SIP authentication](https://www.rfc-editor.org/rfc/rfc3261.html),
[ICE](https://www.rfc-editor.org/rfc/rfc8445.html),
[FreeSWITCH recording implementation](https://github.com/signalwire/freeswitch/blob/master/src/switch_ivr_async.c),
[FreeSWITCH PCM formats](https://github.com/signalwire/freeswitch/blob/master/src/mod/formats/mod_sndfile/mod_sndfile.c).
