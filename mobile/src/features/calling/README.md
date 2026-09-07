# Mobile Calling

## Navigation

The first tab is **Dial Pad** and mounts `screens/DialerScreen` immediately.
There is no separate Home/New call step. Call history lives only in
`screens/RecentsScreen`; tapping a recent passes its identity to the dialer.
The header conference icon opens `screens/ConferenceScreen`. Each participant
is resolved as a regular phone number or a company-directory extension.
Individual accounts can conference regular numbers but never query a company
directory. External participants require an authorized caller ID and the
server's outbound entitlement, wallet and destination-policy checks.

`VoiceContext.tsx` coordinates UI actions and persistent engine subscriptions.
`engine/useVoiceRegistration.ts` selects the configured edge, obtains credentials,
registers device tokens and renews/reconnects sessions. `engine/voiceClientFacade`
offers a stable contract for SIP and Telnyx; `engine/engines` selects adapters.

## SIP Path

`runtime/sipNative::ensureSipRegistration` single-flights foreground/push bootstrap,
checks SecureStore expiry and session identity, then registers. Logout invalidates
pending work. `engine/sipStackSipJs` adapts SIP.js/WebRTC; `sipBridge` translates
stack events to the feature bus; `sipCallEngine` exposes voice call objects.
`sipRegistrationKeeper` handles signaling retries. `callUi::bindCallUi` mirrors
native calls and queues Answer until the INVITE exists, with explicit deadlines.

Cached SIP configuration is also bounded by numeric TURN REST username deadlines.
This applies to legacy caches whose stored expiry exceeded the relay grant: an
expired relay grant triggers bootstrap renewal, and a live grant caps the remaining
lifetime returned to the registration coordinator. Bootstrap integration tests
cover both migration paths. Shipping this cache migration requires a mobile release.

## State and Media

`state/callLifecycle` protects termination/renegotiation operations. `media/`
contains permission, ringtone, network presentation and ICE/media recovery.
`engine/callState`, `callIdentity` and `session` translate state/identity/token data.
Screens render the context; components provide dialpad, caller-ID/rate selection
and connectivity display. Do not open another signaling client in a screen.

### Native control acknowledgments

`callUi` deduplicates mute/hold state before crossing the native bridge. Native
user commands update SIP, while acknowledgments do not generate another command.
The iOS manager additionally correlates mirrored CallKit transactions by action
UUID, so a delayed acknowledgment cannot reverse a newer control state.
`sipBridge` serializes competing changes separately for hold and mute.

### Irrecoverable transport loss

`VoiceContext::emergencyTransportCleanup` stops UI timers, media confirmation,
recovery work and call subscriptions. It invokes `emergencyEndCall`, not just
`endNativeCall`. The SIP adapter retires its tracked call, closes the SIP.js
session-description handler (tracks and peer connection), removes its listener,
and bounds SIP disposal to 2.5 seconds. Late ACTIVE events cannot resurrect it.
Native call UI closure runs independently from the signaling acknowledgment.

`state/routeCancellation` persists pending route cancellation before sending it.
`runtime/routeCancellation` stores it in device-only SecureStore, bound to the
original login. Only `{ canceled: true }` removes a pending entry. Reconnect,
foreground resume and a mounted-provider 30-second retry loop drain the queue.
A different login never replays the old record with its credentials. The queue
is capped at 64 entries and fails visibly rather than silently evicting work.
Remote completion still requires network access and a valid original session;
these retries are not a server-side worker and cannot execute while JS is killed.
The API leaves failed carrier-leg cancellation retryable instead of returning a
false success. Physical offline/foreground/killed-state tests remain release gates.

## Native and Tests

`mobile/native/` owns CallKit/Android incoming-call UI and background startup;
`mobile/plugins/` installs it in native builds. `mobile/index.js` is the fixed entry.
The Telnyx adapter remains in `runtime/voipClient` for the managed edge.

Run mobile `npm run typecheck` and `npm test`. Unit tests are colocated; mounted
provider/secure-bootstrap tests are in `tests/voip/`. After native edits, compile
both platforms and verify physical killed-state delivery, answer/cancel races,
audio and network migration. Vercel deployment alone cannot ship native fixes.
