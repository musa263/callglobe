# Vocivo Production Readiness Review

Date: 2026-09-05
Baseline: main, commit 510d1ba. References below point to the local working tree after this review's changes.

Follow-up: [Seven requested SIP fixes and their verification status](sip-seven-fixes-2026-09-05.md). The findings below retain the original audit observations; consult the follow-up for subsequent local remediation and remaining release gates.

## Release Decision

**Not ready for a commercial release yet.** Local fixes and passing automated tests do not close the remaining native, SIP authorization, routing, and media validation gates.

This review inventoried 425 tracked files. The source/config inventory contains 218 frontend files (22,693 lines), 82 mobile files (10,807 lines), 31 service files (4,063 lines), and 5 workflow files (1,367 lines), excluding lockfiles and binary assets. Counts were taken before adding this report and include tests in those folders.

Work performed: repository-wide searches, manual reading and cross-file tracing of the critical calling, registration, push, AI, authorization, storage, and deployment paths, dependency audits, compilation, and local regression tests. **This is not a claim that every line of all 425 files, generated code, or dependencies received exhaustive manual review.** A static review cannot prove an absence of bugs.

Status meanings:
- **Fixed locally:** implementation and relevant local tests changed; not deployed.
- **Open:** defect or missing control visible in code, still requires implementation/verification.
- **Validation required:** risk visible in configuration, but production impact needs network/native evidence.

No live routing, credentials, database records, or cloud services were modified in this review. No real customer calls were placed by the test fixtures.

## High

### H01. REGISTER authentication is not bound to the AOR being registered
**Open. Security / SIP authentication.**

Evidence: [frontend/api/_lib/features/sip/routes/voice-sip-auth.ts:43](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/features/sip/routes/voice-sip-auth.ts:43>), [services/sip/kamailio/kamailio.cfg:226](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:226>).

The API validates the Digest username/password but never compares the supplied From/To users with that authenticated username. Kamailio passes those users to the API, then calls save("location") after a successful password check without an ownership comparison. A valid credential for one extension is therefore not sufficient proof that the requested registration AOR belongs to it.

Impact: a user with valid credentials and knowledge of another extension's AOR could attempt to register a contact against that AOR, intercept incoming calls, or displace legitimate contacts. This is a static authorization defect; no exploit was attempted against production.

Remediation: bind REGISTER To/From AOR and realm to the authenticated credential's extension, normalize URI encoding consistently, reject mismatches before save, and test same-tenant and cross-tenant impersonation. Also track Digest nonce-count/replay state atomically: the existing signed nonce limits replay to its lifetime but does not consume duplicate responses.

### H02. Conference room routing bypasses tenant authorization
**Open. Security / conference admission.**

Evidence: [services/sip/kamailio/kamailio.cfg:388](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:388>), [services/sip/kamailio/kamailio.cfg:362](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:362>), [services/sip/freeswitch/dialplan/public.xml:5](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/freeswitch/dialplan/public.xml:5>).

The conf-* INVITE branch executes before the authentication and route-token checks. REFER routing also accepts conference targets. FreeSWITCH answers and joins a room named only by the supplied suffix, without tenant membership validation.

Impact: unauthorized room creation/resource consumption, and room admission without tenant authorization when a room name is known. Random-looking room IDs are not an authorization boundary.

Remediation: require a signed, tenant-scoped conference membership grant and authenticate in-dialog REFER against the existing dialog. Namespace rooms by tenant. Reject untrusted conference entry until those checks exist. Test unauthenticated, cross-tenant, expired-grant, and guessed-room requests.

### H03. Eight-second wake-up window and contact snapshots lose mobile recipients
**Open. SIP routing / directly related to the supplied 480 screenshot.**

Evidence: [services/sip/kamailio/kamailio.cfg:499](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:499>), [services/sip/kamailio/kamailio.cfg:571](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:571>).

When no contact is present, WAIT_REGISTER checks immediately, waits once for eight seconds, then returns 480 if registration is still absent. It does not resume immediately on a successful registration. When a web contact already exists, lookup forks the contacts present at that moment; a mobile contact registering after its push is not added to that live transaction. The failure route only tries again after the initial branches fail.

Impact: cold phones can display native ringing but never receive the INVITE, while the caller waits or gets an abrupt unavailable result. Strong internet signal does not remove cold-start, auth, or push delays.

Remediation: registration-driven transaction resumption/forking with a bounded deadline, cancellation guards, one winner, and rejection of late answers. Do not restore the old repeated async_route loop: this configuration documents its prior branch-exhaustion failure. Validate no-contact, web-already-online, two phones, slow registration, and CANCEL-during-wake cases on the actual SIP stack.

**Audible unavailable handling remains missing for direct internal calls.** Those calls bypass FreeSWITCH, while the server-side spoken prompts are in its dialplan. The local UI now displays a friendly message, but that is not an audible announcement. Add a tenant-aware announcement/media route and verify early media or answer/playback/hangup on both clients. The web client currently disables early media at [frontend/src/features/calling/engine/sipSession.js:101](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipSession.js:101>).

### H04. Mid-call re-INVITEs are processed as new outbound/internal calls
**Open. Signaling / network handover / hold.**

Evidence: [services/sip/kamailio/kamailio.cfg:177](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:177>), [mobile/src/features/calling/engine/sipStackSipJs.ts:158](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/sipStackSipJs.ts:158>).

All INVITEs enter route(INVITE) before the has_totag()/loose_route() dialog handler. SIP.js hold and ICE restart send session re-INVITEs without the initial authorization headers. Internal calls consequently encounter the new-call route-token check again; their in-dialog Request-URI may also be a contact rather than the originally authorized extension.

Impact: rejected/misrouted renegotiation, broken hold, and audio failing after Wi-Fi/cellular migration.

Remediation: validate and route in-dialog requests before initial INVITE authorization, retaining dialog ownership/security checks and appropriate SDP relay handling. Verify an actual successful re-INVITE/200/ACK exchange and bidirectional media after network migration, not merely a local restartIce invocation.

### H05. Native Answer can be acknowledged before an INVITE exists; push wake is not connected to registration
**Open. iOS and Android background call lifecycle.**

Evidence: [mobile/src/features/calling/engine/callUi.ts:112](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/callUi.ts:112>), [mobile/src/features/calling/engine/callUi.ts:132](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/callUi.ts:132>), [mobile/src/features/calling/runtime/sipNative.ts:130](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/runtime/sipNative.ts:130>), [mobile/native/ios/VocivoSipCallManager.swift:240](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/ios/VocivoSipCallManager.swift:240>).

The native Answer callback immediately invokes bridge.answer(callId); if the INVITE has not arrived, requireSession throws and the binding only logs the failure. There is no pending-answer queue here. CallKit's action is fulfilled immediately after emitting the JS event. createSipVoiceClient does not supply bindCallUi's optional onPushWake callback, so the received push event does not itself refresh/register SIP.

Impact: native UI appears answered without an established call, especially during a killed/warm background start. The server wake timeout compounds the race.

Remediation: queue user actions by the pushed call ID until the corresponding INVITE exists, cancel them on remote cancellation/expiry, wire push wake to authenticated registration, and resolve/fail the native Answer action according to the actual signaling result within a bounded deadline. Test real locked/killed devices, including Answer before REGISTER and CANCEL racing Answer.

### H06. Android self-managed incoming-call UI and killed-process runtime startup are incomplete
**Open. Android native delivery.**

Evidence: [mobile/native/android/VocivoConnection.kt:18](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/android/VocivoConnection.kt:18>), [mobile/native/android/VocivoConnection.kt:24](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/android/VocivoConnection.kt:24>), [mobile/native/android/VocivoSipIncomingCall.kt:66](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/android/VocivoSipIncomingCall.kt:66>).

The connection declares PROPERTY_SELF_MANAGED but onShowIncomingCallUi is empty, based on a comment that the system will draw the UI. The FCM path calls addNewIncomingCall and queues a JS event; no Vocivo notification/answer-action implementation or explicit headless SIP runtime startup is present in that path.

Android requires a self-managed app to supply the incoming-call UI; the empty method is not a working system ringtone/answer screen. See [Android Connection API](https://developer.android.com/reference/android/telecom/Connection#onShowIncomingCallUi()).

Remediation: implement the supported incoming-call notification/full-screen behavior and answer/reject actions, with background runtime startup and OS-version/permission handling. Native onAnswer must not mark the connection active before SIP succeeds. Test physical Android devices in background/swiped-away states; force-stop has different OS restrictions and must not be promised to work.

### H07. Registration retry was conditional on socket loss, not registration loss
**Fixed locally. Web and mobile signaling.**

Evidence: [frontend/src/features/calling/engine/sipRegistrationKeeper.js:36](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipRegistrationKeeper.js:36>), [mobile/src/features/calling/engine/sipRegistrationKeeper.ts:38](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/sipRegistrationKeeper.ts:38>), [frontend/src/features/calling/engine/sipSession.js:42](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipSession.js:42>), [frontend/src/features/calling/hooks/useSipVoice.js:191](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/hooks/useSipVoice.js:191>).

A failed REGISTER on a still-connected socket could remain unregistered indefinitely. Stale SDK Registered state could also prevent re-registration after transport recovery. The web hook marked Ready immediately after sending the request, before the registrar acknowledged it.

Changes: bounded retry/backoff on registration failure, explicit registered/unregistered callbacks, forced re-registration after disconnect, serialized recovery, canceled retry timers on teardown, and Ready only after a real registration event.

Validation: web/mobile keeper regressions plus the mounted web App test. This does not fix server auth failures, expired credentials, bad DNS/TLS, or the native bootstrap gaps above.

### H08. Web transport loss does not bound the lifetime of an active call UI
**Open. Web state/media recovery.**

Evidence: [frontend/src/features/calling/hooks/useSipVoice.js:191](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/hooks/useSipVoice.js:191>), [frontend/src/features/calling/engine/sipSession.js:37](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipSession.js:37>), [frontend/src/features/calling/engine/sipSession.js:127](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipSession.js:127>).

Transport loss updates registration readiness and retries signaling, but does not start an active-call media-health deadline or reconcile an orphaned call. The web adapter has no active peer ICE-failure recovery listener. A call whose termination cannot arrive over the broken signaling path can remain displayed as active.

Remediation: distinguish healthy continuing RTP from dead media, allow a short bounded recovery window, renegotiate through the SDK, and clear UI/timers/native equivalents when recovery actually fails. Test lost WebSocket with live RTP separately from simultaneous loss of both. Do not mark every short signaling interruption as a hung-up call.

### H09. AI service failures and message capture could end a conversation without caller intent
**Fixed locally for the identified paths. AI receptionist.**

Evidence: [services/receptionist/app/brain.py:272](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/brain.py:272>), [services/receptionist/app/call.py:76](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:76>), [services/receptionist/app/call.py:116](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:116>), [services/receptionist/app/speech.py:168](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/speech.py:168>).

Previously, a transient model failure selected transfer/message actions, a message action hung up immediately, and a transcription failure returned an empty string. Two such empty strings were treated as caller silence and could trigger transfer/hangup.

Changes: transient model errors request a repeat; permanent-error fallback transfers are allowlisted and office-hours aware; message capture continues until an explicit hangup action; recognizer load/inference failures are distinct from silence and ask for repetition. Collected notes are retained, and temporary recordings are discarded even on transcription failure.

Validation: model failures, recognizer failures, and multi-turn message capture are covered locally. Full-duplex conversation quality, live model behavior, and all hangup causes are not proven by these tests.

### H10. Invalid/racing speech cache files can make prompts silent
**Fixed locally. AI voice rendering.**

Evidence: [services/receptionist/app/speech.py:105](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/speech.py:105>).

A non-empty cached file was previously accepted as playable audio, including malformed data. Concurrent writers shared an intermediate filename.

Changes: verify cached WAV structure/frame metadata, regenerate invalid entries, and use independent temporary files with atomic replacement. Regression tests cover malformed cache entries and concurrent rendering. This is not an acoustic-quality or complete truncated-media validation test.

### H11. Public SIP extension lookup permitted untrusted sources
**Fixed locally; server validation/deployment still required. SIP ingress security.**

Evidence: [services/sip/kamailio/kamailio.cfg:451](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:451>), [frontend/api/_lib/features/sip/sip-config.test.ts:7](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/features/sip/sip-config.test.ts:7>).

The public non-loopback extension branch could lookup/fork contacts or trigger pushes without checking that the sender was a trusted trunk. Added TRUNK_SOURCE allowlisting before both lookup and wake-up.

Validation: structural regression guard passes. Kamailio's runtime parser and live allowlisted/untrusted-source tests have not run locally because that runtime is unavailable. The deployment must have the correct carrier source allowlist. This fix does not close the separate conference or REGISTER ownership gaps.

## Medium

### M01. Outgoing ringback represented local setup, not remote ringing
**Fixed locally on web.**

Evidence: [frontend/src/features/calling/hooks/useSipVoice.js:259](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/hooks/useSipVoice.js:259>), [frontend/src/features/calling/hooks/useSipVoice.js:289](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/hooks/useSipVoice.js:289>), [frontend/src/features/calling/engine/sipSession.js:117](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipSession.js:117>).

The web client played a ringtone before route lookup/INVITE progress. It now starts ringback only on SIP 180 and stops on answer/termination; 100 Trying does not ring. The browser regression verifies no tone while route setup is pending and after answer. No simulated network result was introduced.

### M02. Routine call outcomes were rendered as red protocol errors
**Fixed locally on SIP web/mobile paths.**

Evidence: [frontend/src/features/calling/engine/sipDial.js:37](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/engine/sipDial.js:37>), [frontend/src/App.jsx:292](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:292>), [mobile/src/features/calling/VoiceContext.tsx:328](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/VoiceContext.tsx:328>), [mobile/src/features/calling/screens/DialerScreen.tsx:131](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/screens/DialerScreen.tsx:131>).

480/408, busy, and declined outcomes now use friendly notices; actual failures retain error treatment. Mobile carries the numeric termination code through the bridge instead of losing the distinction, and allows messages to wrap. Desktop/mobile web screenshots confirm the neutral notice and no overflow.

Scope: this is text presentation, not spoken unavailable handling or verification of every legacy Telnyx outcome.

### M03. Nonessential bootstrap work and eager admin loading delayed the web phone
**Fixed locally in part; bundle debt remains.**

Evidence: [frontend/src/App.jsx:15](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:15>), [frontend/src/App.jsx:403](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:403>), [frontend/src/App.jsx:520](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:520>).

The authenticated phone no longer waits for account/rates/number bootstrap before rendering. Session verification remains mandatory. Administration is lazy-loaded, and the startup screen now uses the real Vocivo logo and an accessible/reduced-motion loading indicator.

Build result: main app JS decreased from about 206.91 KB to approximately 86 KB; the remaining 907.37 KB vendor chunk still needs work. This is bundle measurement, not a measured production load-time guarantee.

### M04. Shared PBX configuration still lacks a database tenant boundary
**Open. Storage isolation / concurrency scope.**

Evidence: [frontend/api/_lib/features/organizations/pbx-config-store.ts:61](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/features/organizations/pbx-config-store.ts:61>), [frontend/api/_lib/shared/object-store.ts:148](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/shared/object-store.ts:148>), [frontend/api/_lib/shared/object-store.ts:252](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/shared/object-store.ts:252>), [frontend/api/_lib/shared/object-store.ts:695](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/shared/object-store.ts:695>).

Tenant SaaS subscriptions/admins/entitlements have row-scoped queries and RLS policies. PBX configuration still lives in one platform object; the generic object table has no organization column or tenant RLS. Its ownership boundary relies on application filtering.

The current object update routines do use transactions, advisory locks and etag/CAS checks. It would be incorrect to report them all as unprotected sequential writes. The remaining risks are shared-blob contention and the absence of database defense-in-depth for those objects, not a demonstrated arbitrary tenant API read.

Remediation: incrementally move tenant-owned PBX records to explicit tenant rows, retain platform-only configuration separately, and run real Postgres RLS tests using a non-bypass role and concurrent tenants.

### M05. ESL command deadlines and completion correlation are incomplete
**Open. Receptionist event lifecycle.**

Evidence: [services/receptionist/app/esl.py:112](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/esl.py:112>), [services/receptionist/app/esl.py:163](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/esl.py:163>), [services/receptionist/app/esl.py:168](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/esl.py:168>).

The command lock protects sending/reply receipt, not the subsequent completion read. Overlapping commands can create concurrent reads from one StreamReader. Initial command acknowledgments have no deadline. Completion timeout returns None, which callers may treat like successful completion.

Remediation: one reader/dispatcher, command IDs and completion correlation, bounded acknowledgment plus execution deadlines, and explicit timeout/hangup outcomes. Current call flow is largely serial, so the overlapping-read risk is conditional, not proof that every call encounters it.

### M06. AI listening is half-duplex and has hard turn/utterance limits
**Open. Conversation behavior.**

Evidence: [services/receptionist/app/config.py:59](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/config.py:59>), [services/receptionist/app/call.py:71](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:71>), [services/receptionist/app/call.py:211](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:211>).

Recording is capped at 20 seconds per utterance, silence at three seconds, initial patience at ten seconds, and the conversation at 30 turns. Speech is recorded only while listening, not while the assistant speaks/thinks. Long utterances and interruptions can therefore be lost; the turn limit intentionally ends the call.

Remediation: define and test a real conversation policy, use streaming recognition/VAD and supported barge-in, and give a clear warning/transfer option near a conversation deadline. Simply removing all limits risks permanently held channels.

### M07. AI auxiliary work can outlive calls; speech failures can produce silent turns
**Open. Resources / observability.**

Evidence: [services/receptionist/app/call.py:46](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:46>), [services/receptionist/app/call.py:154](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:154>), [services/receptionist/app/call.py:188](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/call.py:188>), [services/receptionist/app/esl.py:196](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/receptionist/app/esl.py:196>).

Prerender/model/next-sentence tasks are not all tracked by a call-level cancellation scope. _speak catches synthesis failures and can skip every sentence without a deterministic audible fallback. ESL hangup/close errors are silently ignored. The recording/connection cleanup improved in this pass does not cover every task.

Remediation: supervise call-owned tasks, cancel and await them on exit, distinguish expected closed sockets from failed termination, and use a verified local fallback prompt with bounded retry.

### M08. TURN has no TLS fallback and a narrow relay-port pool
**Validation required. Deployment capacity / restrictive mobile networks.**

Evidence: [services/sip/docker-compose.yml:78](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/docker-compose.yml:78>).

Coturn disables TLS/DTLS and exposes 3478 with only ports 49152-49200 configured for relays. This is 49 port numbers per relay address, not proof of support for thousands of simultaneous calls. Networks allowing only TLS/443 may have no usable relay path.

Remediation: provision a real TURNS/TLS route and certificate, size relay ports against measured concurrent allocations, and test forced-relay calls over UDP-blocked networks. Do not assume HTTPS/WSS on 443 also serves TURN. Short-lived TURN credentials are already used; do not replace them with a client-visible permanent secret.

### M09. Internal call-history delivery is not durable
**Open. Call records / billing evidence.**

Evidence: [services/sip/kamailio/kamailio.cfg:57](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:57>), [services/sip/kamailio/kamailio.cfg:531](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/kamailio/kamailio.cfg:531>).

The in-memory CDR queue holds 4,000 entries. Fetch removes events before HTTP delivery succeeds; failures are logged without retry, and HTTP error responses are not handled as delivery failures. A process restart or API outage can lose records.

Remediation: durable idempotent outbox delivery with retry/backoff and dead-letter monitoring. Validate duplicate/out-of-order events and API downtime before relying on this history for reconciliation.

### M10. Caller identity and native call-history reasons remain inconsistent
**Open. Mobile identity / native UI.**

Evidence: [mobile/src/features/calling/engine/useVoiceRegistration.ts:118](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/useVoiceRegistration.ts:118>), [mobile/native/ios/VocivoSipCallManager.swift:104](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/ios/VocivoSipCallManager.swift:104>), [mobile/native/ios/VocivoSipCallManager.swift:136](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/ios/VocivoSipCallManager.swift:136>), [mobile/src/features/calling/engine/callUi.ts:99](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/callUi.ts:99>).

The SIP registration path sets displayName to the opaque SIP username. iOS uses a phoneNumber handle for any non-empty number, including SIP text, and collapses several termination reasons into remote-ended. The binding discards the richer termination distinction when reporting to native UI.

Remediation: resolve verified colleague identity server-side, keep routable SIP values separate from display handles, select generic handles for non-E.164 identities, and preserve local/remote/declined/unanswered reasons through native reporting. Do not trust an arbitrary client display name as verified caller identity.

### M11. Push expiration/token refresh coverage differs by platform
**Open. Background delivery.**

Evidence: [mobile/native/android/VocivoSipIncomingCall.kt:32](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/android/VocivoSipIncomingCall.kt:32>), [mobile/native/ios/VocivoSipCallManager.swift:190](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/native/ios/VocivoSipCallManager.swift:190>), [frontend/src/sw.js:9](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/sw.js:9>), [mobile/src/features/calling/engine/useVoiceRegistration.ts:83](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/engine/useVoiceRegistration.ts:83>).

Android's custom incoming handler checks signed-in state but not push expiry. The service worker shows generic incoming notifications without call expiry/cancellation reconciliation. iOS performs an expiry check, but its token-invalidation event only clears native storage. Token changes still depend on app-side registration reaching the server.

Remediation: consistent call IDs, deadlines and cancellation handling across native/web pushes; persist and synchronize token rotation/revocation with idempotent retries. Browser notification delivery is not itself a persistent SIP runtime capable of answering a closed-tab call.

### M12. Production releases can mix incompatible web, SIP and AI versions
**Open, with local deployment-path correction.**

Evidence: [deploy-production.sh:44](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/deploy-production.sh:44>), [.github/workflows/ops-sip-edge.yml:326](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/.github/workflows/ops-sip-edge.yml:326>), [services/sip/docker-compose.yml:69](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/services/sip/docker-compose.yml:69>).

The root script deploys web/API only. SIP configuration and AI containers have separate operations workflows and mutable image tags. A passing web health endpoint does not prove that compatible native/SIP/AI code is live.

Fixed locally: run Vercel from the repository root, matching the saved frontend Root Directory, instead of accidentally applying the frontend directory twice.

Remediation: a release manifest containing commit/image digests and configuration revision for each component; staged compatibility checks, native build IDs, and coordinated rollback. Do not describe a successful API curl as a successful telephone test.

### M13. Dependency audit contains unresolved advisories
**Open; reachability analysis required before upgrading.**

Read-only npm audit --omit=dev results:
- Frontend: four moderate package entries, no high/critical entries.
- Mobile: nine high and thirteen moderate package entries, no critical entries.

Many mobile entries propagate through Expo CLI/image/postcss build dependencies; these counts are not 22 independently exploitable phone-runtime vulnerabilities. Telnyx transitive uuid advisories also remain. Audit suggested a Telnyx downgrade as one fix, which was deliberately not applied blindly.

Evidence artifacts: /tmp/vocivo-frontend-audit.json and /tmp/vocivo-mobile-audit.json.
Examples: [image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

Remediation: review each advisory against the installed dependency path and actual input exposure; update an Expo-compatible lockfile in a dedicated change, rebuild both native platforms, and rerun call tests.

### M14. Some displayed SIP call tools were not implemented; Hold simulated success
**False-success UI fixed locally; signaling implementation remains open. Web feature behavior.**

Evidence: [frontend/src/features/calling/hooks/useSipVoice.js:468](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/features/calling/hooks/useSipVoice.js:468>), [frontend/src/App.jsx:185](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:185>).

The SIP hook exposes an unsupported handler for advanced call operations while the shared call UI presented those controls. Hold additionally called optional hold/unhold methods absent from SIP.js and then changed local state without sending any request. Feature availability differs from the Telnyx engine.

Changed locally: removed the fake Hold transition; added capability flags; disabled unsupported Hold/Add/Transfer controls on SIP; routed Hold errors through the existing call-action error handler. Browser tests verify controls remain disabled and directly invoking unsupported Hold cannot change an active call's state. The real transactional operations still require implementation, rollback, server authorization, and network tests before re-enabling. Do not replace unsupported functions with simulated success.

## Low

### L01. Production design-preview entry points could be mistaken for live data
**Fixed locally.**

Evidence: [frontend/src/App.jsx:97](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/src/App.jsx:97>), [mobile/src/features/auth/screens/AuthScreen.tsx:108](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/auth/screens/AuthScreen.tsx:108>), [mobile/src/features/auth/AuthContext.tsx:267](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/auth/AuthContext.tsx:267>).

Production builds no longer offer the design-preview entry points; mobile also guards the underlying action. Development previews and test fixtures remain available for QA. No production simulated SIP transport was found in the active adapters: they instantiate SIP.js or the selected Telnyx SDK. Tests deliberately mock networks and must not be deleted as though they were live calling code.

### L02. Health labels and comments misstate the selected architecture
**Fixed locally for the health response; other documentation cleanup remains.**

Evidence: [frontend/api/platform/[resource].ts:62](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/platform/[resource].ts:62>), [frontend/api/_lib/features/calling/voice-provider.ts:15](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/features/calling/voice-provider.ts:15>), [mobile/src/features/calling/runtime/sipNative.ts:25](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/mobile/src/features/calling/runtime/sipNative.ts:25>).

The health endpoint hardcoded mediaPlane=telnyx. It now reports the configured provider and explicitly says telephonyStatus=unchecked. A configuration label is still not a live media probe. Some native comments/errors still imply a Telnyx fallback where a SIP build can instead be unavailable.

### L03. Test gate names overstate end-to-end coverage; vendor bundling remains coarse
**Open. Tooling / maintenance.**

Evidence: [verify.sh:1](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/verify.sh:1>), [.github/workflows/quality.yml:50](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/.github/workflows/quality.yml:50>), [frontend/vite.config.js:52](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/vite.config.js:52>).

The root verification script tests web/API and mobile JS, not actual calls. CI adds receptionist tests and XML syntax checks, but neither establishes native lock-screen, Kamailio routing, or real RTP behavior. The forced single vendor chunk also loads unrelated SDK code together.

Remediation: distinguish compilation/unit/mock integration/native/network gates in release output; add actual multi-device SIP tests and split provider-specific dependencies with measured cache/load effects. Keep the bundle warning visible until the bundle is reduced.

## Infrastructure: What Is Actually Verified

- Live DNS lookup in this review: sip.vocivo.app resolves to **168.144.183.82**, matching the SIP runbook. The older PBX host **68.183.244.215** is a separate optional host in those docs.
- Repository architecture supports **Vocivo-operated Kamailio + RTPEngine + FreeSWITCH + coturn**, with Vocivo's Python AI orchestration and web/API. These are active components, not simulated SIP or automatically obsolete migration files.
- Web/API deployment is configured for **Vercel**, storage uses **Postgres**.
- **Telnyx remains the configured PSTN trunk/number carrier**, with a managed-SDK fallback path still present. Internal calls on the sip edge are designed not to require Telnyx credit; see [frontend/api/_lib/features/calling/voice-provider.ts:19](</Users/musausman/Desktop/CLAUDE APPS PROJECTS/callglobe-Codex/frontend/api/_lib/features/calling/voice-provider.ts:19>). That does not make cloud CPU, bandwidth, storage, or AI providers free.
- VOCIVO_VOICE_EDGE must actually be sip in the live environment for that client path. Missing/other values select Telnyx. Reading source alone does not verify the live setting.
- The public health response observed during this review still used the old hardcoded Telnyx label. It cannot prove which provider carried a particular call.
- **Legal/account ownership of the cloud resources was not verified.** DNS and source prove addressing/design, not who owns the DigitalOcean/Telnyx/Vercel accounts. This review had no authenticated cloud-account inventory or successful SSH inspection of the live SIP containers. Do not claim the whole service is independent of Telnyx, or that all infrastructure is owned by Vocivo, from these facts alone.

## Local Verification Results

- Backend API TypeScript: passed.
- Backend/web tests: **294 passed**.
- Production web build: passed; vendor-size warning remains.
- Mobile TypeScript: passed.
- Mobile tests: **97 unit + 5 provider integration tests passed**.
- Receptionist tests: **48 passed**, including local socket-based ESL fixtures.
- Browser regressions: **13 passed** across two scripts, mounting the real hook/App with intercepted API/SIP fixtures.
- Shell syntax for deploy-production.sh: passed.
- git diff --check: passed.
- Screenshots inspected: branded loading state and unavailable notice at desktop and 390px mobile width.
- No physical iOS/Android calls, real bidirectional audio, locked/killed-device push, live Kamailio validation, cloud stress test, or 5,000-user test passed in this review. Those were **not run**, not silently waived.

Local UI: http://127.0.0.1:5183/
Screenshot artifacts: /tmp/vocivo-loading-desktop.png, /tmp/vocivo-loading-mobile.png, /tmp/vocivo-unavailable-desktop.png, /tmp/vocivo-unavailable-mobile.png.
The local Vite server proxies real /api requests to production when used outside the intercepted tests. It is not an offline simulated backend; do not place unintended customer calls while exploring it.

## Next Release Gates, In Order

1. Close REGISTER ownership and conference authorization gaps; validate untrusted-source blocking.
2. Fix dialog routing, registration-driven mobile fork delivery, and native pending-answer handling together.
3. Implement and hear the named unavailable announcement on web, iOS and Android.
4. Test long AI conversations, provider outages, silence, interruptions, transfer answer, caller cancellation, and failed playback.
5. Validate forced TURN, network migration and bidirectional RTP using two real devices plus web.
6. Ship matching server/native/web revisions through staging; only then run a controlled production smoke test and approve release.
