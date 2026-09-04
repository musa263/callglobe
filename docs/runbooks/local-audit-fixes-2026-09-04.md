# Local audit remediation: first batch

Date: 2026-09-04
Baseline: 41601a2
Scope: targeted corrections to the audited calling, push-delivery, session-security, and resource-lifecycle paths. No provider migration, production configuration changes, dependency upgrades, commits, or deployments were performed.

## Source map and verification

| Finding | Source section | Change and evidence |
| --- | --- | --- |
| SIP INVITE waits on database and push-provider latency | `frontend/api/_lib/routes/voice-sip-wakeup.ts` | The wake endpoint acknowledges the stable call ID and schedules directory lookup and push delivery through Vercel's background continuation. A regression test holds directory I/O open and verifies the response completes first. The edge's HTTP round trip and registration wait still exist; this is not a claim of zero setup latency. |
| iOS ignores the server's nested push payload | `mobile/native/ios/VocivoSipCallManager.swift` | Reads the `vocivo` envelope, retaining the call ID and caller identity used by the subsequent INVITE. Swift type-check passed. Physical PushKit delivery remains a release gate. |
| Android ignores the server's FCM message type | `mobile/native/android/VocivoSipIncomingCall.kt` | Accepts `vocivo.incoming_call` as well as the previous `vocivo.call` type. A new native Android build and device test are still required. |
| Two competing iOS PushKit registries | `mobile/plugins/withTelnyxVoip.js`, `mobile/native/ios/VocivoSipCallManager.swift` | AppDelegate owns the registry and dispatches custom SIP pushes to the SIP manager. Token updates and invalidations reach both adapters. A prebuild-transform test verifies one registry and idempotent generation. |
| Signed-out iPhone can act on a custom push | `mobile/native/ios/VocivoSipCallManager.swift` | Signed-out or expired pushes satisfy the CallKit reporting requirement, then end immediately without emitting a SIP wake event. This does not revoke already-issued server pushes; device-side behavior needs a physical test. |
| SIP startup depends on Telnyx token availability | `mobile/src/voice/useVoiceRegistration.ts` | Resolves the configured provider first. SIP startup fetches SIP credentials without requesting or storing Telnyx tokens. Missing SIP native support surfaces an error instead of silently switching providers. Mounted registration tests pass. |
| Configuration-fetch failure selects the wrong provider | `frontend/src/hooks/useVoice.js`, `mobile/src/voice/useVoiceRegistration.ts` | Failed configuration reads retry without starting the other provider. The mobile regression test covers failure followed by recovery. |
| Refreshed/failed device-token persistence is lost | `mobile/src/voice/useVoiceRegistration.ts` | Registers refreshed tokens with the Vocivo backend and retries failed initial writes. Registration is not reported successful until persistence succeeds. Mounted test covers the failed-write retry. |
| Mobile call timer waits on polling/RTP checks | `mobile/src/context/VoiceContext.tsx` | Direct SIP and incoming ACTIVE calls start their UI timer without waiting for the RTP health probe. Telnyx outgoing agent legs still wait for the destination-answer route signal. Removes the duplicate tight status poll. Fixes synchronous ACTIVE replay before the active-call ref exists. Mounted provider tests pass; real audio latency is not measured by these tests. |
| SIP network recovery expects a Telnyx call wrapper | `mobile/src/lib/voiceRecovery.ts`, `mobile/src/voice/sipCallEngine.ts`, `mobile/src/voice/sipBridge.ts`, `mobile/src/voice/sipStackSipJs.ts` | Exposes the SIP peer connection and a SIP.js-owned ICE-restart re-INVITE, preserving hold state and bounding its answer wait. Passes authenticated TURN configuration to the peer connection. Recovery and bridge tests pass; Wi-Fi/cellular media must still be measured on devices. |
| Web hangup uses incompatible commands and misses incoming termination | `frontend/src/voice/sipCallLifecycle.js`, `frontend/src/hooks/useSipVoice.js` | Selects CANCEL, reject, or BYE according to dialog state, serializes duplicate termination requests, observes incoming and outgoing terminal events, prevents late Answer completion and late routing responses from reopening canceled calls. Unit tests and four real-browser hook scenarios pass with mocked SIP/API transport. |
| Subscription/failed-start resources remain attached | `frontend/src/voice/sipSession.js`, `mobile/src/voice/sipStackSipJs.ts`, `mobile/src/voice/sipBridge.ts` | Explicit registration-listener removal, call-listener terminal cleanup, and failed-start transport shutdown. Previously ignored shutdown errors are reported. Bridge test verifies failed startup stops the stack. This is targeted cleanup, not a claim that all listeners throughout the repository have been audited again. |
| Owner revocation-store failures permit access | `frontend/api/_lib/auth.ts` | Database errors now reject authentication instead of treating the revocation timestamp as zero. Tests exercise real owner authentication with unavailable storage and ensure the failure is not cached as authorization. |
| Platform API-key mutations overwrite concurrent changes | `frontend/api/_lib/platform-key-store.ts` | Create and revoke now use the existing advisory-lock/row-lock/CAS transaction primitive, reading the current encrypted list inside the transaction. API type-check passed. Multi-connection PostgreSQL concurrency verification remains pending; no live database was mutated. |
| Legacy browser bearer token remains in localStorage | `frontend/src/lib/api.js` | Purges legacy token-bearing sessions and requires renewed cookie login. Test verifies both legacy deletion and token-free profile storage. |
| Receptionist test leaks an ESL socket | `services/receptionist/tests/test_call_flow.py` | Both test socket ends close in `finally`. All 41 receptionist tests pass without the previous unclosed-socket warning. |

## Local checks

- Frontend/backend: `npm test` (288 tests), `npm run check:api`, `npm run build`.
- Mobile: `npm test` (93 unit tests and 5 mounted integration tests), `npm run typecheck`.
- Browser: `frontend/scripts/test-sip-ui.mjs` against local Vite. Mocks carrier/SIP transport and API responses; it never places real calls. Covers incoming CANCEL, Answer/CANCEL collision, cancellation during route reservation, and single-BYE active hangup. The harness needs Playwright installed or `PLAYWRIGHT_MODULE` pointing to an existing installation.
- Swift: iOS simulator SDK type-check of `VocivoSipCallManager.swift`; existing deprecated-API warnings remain.
- Receptionist: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`.
- Repository: `git diff --check`.

## Findings not closed by this batch

1. TURN TLS/443 reachability, relay-port capacity, firewall and certificate validation. Port 443 cannot simply be assigned to TURN when the HTTPS proxy already owns it; this needs an explicit deployment design and network test.
2. APNs connection pooling, fan-out backpressure, and OAuth exchange timeouts remain unchanged in `frontend/api/_lib/mobile-push-dispatcher.ts`.
3. Dependency advisories and the large frontend vendor bundle remain. No warning was suppressed and no unvalidated Expo/React Native upgrade was applied.
4. Generic object-store RLS is a remaining defense-in-depth migration, not proof of a demonstrated cross-tenant endpoint exploit. It requires a role/context migration and database integration tests.
5. Default company seed data, unsupported web SIP conference controls, deployment image pinning/health checks, and remaining scattered swallowed-error sites need separate scoped work.
6. A closed PWA cannot be treated as a native PushKit phone. Background Web Push behavior needs browser/platform-specific acceptance testing; arbitrary continuous ringing is not guaranteed.
7. The TTS test environment still needs its audio dependencies. Its earlier missing `soundfile` dependency was not repaired by changing application code.
8. Broad CORS policy needs an endpoint-by-endpoint review; it was not automatically classified as a confirmed credential leak or changed globally.

## Release gates

Do not mark the platform production-ready from these local tests. Still required: signed iOS/Android builds containing the native changes; signed-out, cold-start, background, and multi-device call tests; caller cancellation before/after Answer; two-way audio on Wi-Fi/cellular/restricted NAT; measured answer-to-audio latency; and database concurrency tests against a disposable PostgreSQL instance. No live APNs, FCM, carrier, or PSTN test was performed in this batch.
