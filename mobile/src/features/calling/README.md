# Mobile Calling

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

## State and Media

`state/callLifecycle` protects termination/renegotiation operations. `media/`
contains permission, ringtone, network presentation and ICE/media recovery.
`engine/callState`, `callIdentity` and `session` translate state/identity/token data.
Screens render the context; components provide dialpad, caller-ID/rate selection
and connectivity display. Do not open another signaling client in a screen.

## Native and Tests

`mobile/native/` owns CallKit/Android incoming-call UI and background startup;
`mobile/plugins/` installs it in native builds. `mobile/index.js` is the fixed entry.
The Telnyx adapter remains in `runtime/voipClient` for the managed edge.

Run mobile `npm run typecheck` and `npm test`. Unit tests are colocated; mounted
provider/secure-bootstrap tests are in `tests/voip/`. After native edits, compile
both platforms and verify physical killed-state delivery, answer/cancel races,
audio and network migration. Vercel deployment alone cannot ship native fixes.
