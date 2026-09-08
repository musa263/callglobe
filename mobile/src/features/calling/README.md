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

### Startup critical path

The foreground hook waits for AuthContext to finish local restoration and expose
authenticated state, then fetches `/api/voice/config` before selecting an engine.
An accepted session-bound secure profile snapshot can release this gate while
`/api/auth/session` is pending; voice does not await account/bootstrap enrichment.
The snapshot is not fresh server authorization: voice APIs and SIP registration
still enforce access. A later HTTP session rejection clears authenticated state,
tears down voice and invalidates pending startup work. Initial `loading=true`
does not log out an existing push bootstrap. Fresh profile/account data does not
restart registration when the authenticated/loading flags stay unchanged.
A supplied carrier `bootstrapSession` is startup input, not an effect dependency
that starts a second config request and registration. Managed push startup reads
the secure cached carrier session in this same hook, after configuration selects
Telnyx, and persists prepared credentials before selecting the managed runtime. Configuration failures still stop startup and retry;
there is no cached-provider guess or fallback login to another engine.

On the SIP edge, ringtone preference setup runs independently and wakeup-token
registration starts after signaling bootstrap without blocking it. Push-token
reads and device writes are single-flight across the retry and foreground
listeners. Failures retain a separate unavailable/registering push status and
retry without restarting SIP. Engine connection events alone determine Ready;
foreground connectivity does not imply that background push delivery works.
The managed Telnyx path retains its existing ringtone, token persistence and
push-aware login ordering.

Secure SIP cache and account-token reads overlap, but registration still waits
for a matching current session, credential/TURN expiry checks, device-only secure
writes and logout invalidation checks. A valid secure cache avoids the credential
HTTP request; expired or mismatched credentials require renewal. There is no
startup NetInfo fetch/reachability probe in this hook: the remaining network
waits are live provider configuration, required credential renewal and actual
SIP registration. Account-profile/bootstrap timing belongs to AuthContext, and
HTTP timeout/retry policy belongs to the shared API client.

`VoiceRegistration.integration.test.tsx` covers delayed/failed auxiliary work,
late bootstrap input, cleanup and mounted AuthContext cached-restore/rejection
transitions; `SipBootstrap.integration.test.tsx`
covers overlapping secure reads, cache renewal and session changes. These are
mocked ordering checks, not measured device startup latency or push acceptance.

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
`runtime/managedVoiceRuntime` lazily loads the SDK; `VoiceRoot` mounts it only
for an authenticated, explicitly selected managed engine after session preparation.
SIP startup and sign-out do not instantiate a managed client. Missing/invalid
configuration fails closed. `runtime/nativeVoiceBridge` calls the installed
VoicePnBridge without importing the SDK's JavaScript; this is a compatibility
boundary, and the patched Telnyx native plugin is still required until those
controls move to Vocivo-owned native modules.

“Refresh incoming calls” on SIP renews SIP registration and sends the native push
token to `/api/voice/devices`, without a carrier token request/login. Failures set
push status unavailable and propagate the actionable error. The managed path
retains its token refresh. ManagedRuntimeIsolation, VoiceRegistration and
VoiceContext integration tests cover these boundaries and ordering.

Telnyx session writes, including the patched SDK's credential/token persistence,
use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so push reconnection can read credentials
after the device locks. The first unlock after reboot is still required; existing
cached items migrate when written on an unlocked launch. Tokens remain in
Keychain/Keystore and do not migrate to another device. Short token lifetimes are
preserved and renew before expiry. `TelnyxStorage.integration.test.tsx` verifies
the storage contract, and `telnyxPatch.test.ts` parses both installed SDK source
and runtime and checks both persistence paths. These do not substitute for
locked/killed-state tests on physical iOS and Android hardware.

Run mobile `npm run typecheck` and `npm test`. Unit tests are colocated; mounted
provider/secure-bootstrap tests are in `tests/voip/`. After native edits, compile
both platforms and verify physical killed-state delivery, answer/cancel races,
audio and network migration. Vercel deployment alone cannot ship native fixes.

## Connection recovery

An explicit foreground refresh sends REGISTER even if SIP.js still reports a
live transport and registration. Local flags can survive a network migration.
Idle mobile network changes debounce for one second and request fresh SIP/ICE
configuration; foreground bootstrap rechecks SecureStore expiry after suspended
timers. HTTPS failures retry with bounded backoff. A forced renewal queued behind
a cached bootstrap is retained and shared by concurrent callers. Final 401/403
rejections trigger bounded credential renewal; ordinary Digest challenges remain
inside SIP.js. Active/incoming calls keep their stack during network recovery.

The web client debounces online events and renews idle configuration, and checks
the renewal deadline when a hidden tab returns. Short credential lifetimes renew
at 80% without the previous five-minute floor. The stored SIP password and TURN
configuration have different lifetimes; use the API's configuration expiry.

Run the keeper unit tests, mobile SipRecovery/SipBootstrap integration suites,
`bash verify.sh`, and the browser SIP harness. These prove controlled recovery,
not physical Wi-Fi/5G handoff, killed-state operation, or two-way carrier audio.

## Tenant carrier numbers

Bootstrap can return `source: carrier` numbers with `ready` or
`pending_activation` status. Incoming-call transfer selection can use a ready
carrier number. The API authorizes its current trunk at call time; UI selection
is not carrier activation. These client type/selection changes need a mobile
release; backend number publication is available independently.

Version 1.0.0 build 65 includes the current SIP credential-renewal/contact
preservation fixes and tenant-carrier number support. The September 8 local iOS
Release build is development-signed for the existing provisioned device; it is
not a TestFlight distribution. Physical answer/recovery and live carrier audio
acceptance remain separate from compilation and signature verification.
