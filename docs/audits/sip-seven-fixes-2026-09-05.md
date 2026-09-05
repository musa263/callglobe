# SIP Hardening: Seven Requested Fixes

Date: 2026-09-05
Baseline: main at 48fe04e084e182f71493cceaa4c99c6d2ffb8b62.
Scope: the seven registration, authorization, wake-up, renegotiation, native Answer, Android startup, and web call-lifecycle findings requested for this pass.

## Release Status

**Implemented locally; not deployed or certified for production.** Local compilation and regression checks pass. Native delivery and SIP proxy behavior still require the staging/device checks below. No production credentials, database rows, running SIP service, or customer calls were changed by this work.

This is a targeted follow-up to the earlier production-readiness audit, not a claim that all other findings or every line in the repository are now defect-free.

## Changes by Finding

### 1. Registration identity binding

Section: backend SIP authentication and Kamailio registrar.

- `frontend/api/_lib/features/sip/routes/voice-sip-auth.ts:61` rejects REGISTER if the authenticated Digest username does not match both From and To users, their domains, and the actual request target. It performs this check before reading credential records.
- `frontend/api/_lib/features/sip/sip-registration-auth.ts:13` contains the strict identity checks. Ambiguous URI encodings are rejected rather than normalized into another account.
- `frontend/api/_lib/features/sip/routes/voice-sip-auth.ts:77` consumes a Digest replay key through the existing database-backed atomic replay ledger after successful authentication.
- `services/sip/kamailio/kamailio.cfg:250` also checks identity before registrar.save. Stateful replies prevent legitimate UDP retransmissions from consuming the same Digest twice.

Validation: helper and actual HTTP-handler tests cover valid identity, extension/domain impersonation, duplicate Digest rejection, and a fresh nonce count. The HTTP-handler tests inject credential/replay stores; they are not a live Postgres or wire-level penetration test.

### 2. Conference admission

Section: SIP routing and FreeSWITCH public dialplan.

- `services/sip/kamailio/kamailio.cfg:402` refuses direct `conf-*` entry.
- `services/sip/freeswitch/dialplan/public.xml:5` no longer joins an unvalidated conference room.
- SIP REFER is rejected until a tenant-authorized transfer/admission flow exists; established-dialog validation is mandatory for other in-dialog requests.

**Containment, not a completed conference feature:** direct SIP conference entry and SIP REFER are intentionally unavailable. Enabling them requires signed, tenant-scoped admission and negative cross-tenant tests. A guessed room name is never treated as permission.

Validation: structural configuration regression checks pass. Runtime unauthenticated/cross-tenant SIP probes remain a staging gate.

### 3. Mobile registration window

Section: Kamailio extension delivery.

- `services/sip/kamailio/kamailio.cfg:501` replaces the eight-second registration snapshot/retry with a TSILO-tracked, bounded transaction.
- Current contacts and contacts registered during wake-up are appended to the same call transaction. REGISTER triggers contact append instead of waiting for an eight-second polling tick.
- The transaction has a 45-second maximum lifetime; TSILO/TM handles branch deduplication and refuses appends to cancelled/final transactions.
- Registration and lookup use the same realm-sensitive address-of-record. The SIP Call-ID is also carried as the native push correlation ID.
- Failure paths release the allocated RTP relay session.

Validation: configuration structure and pinned Kamailio API review. No local Kamailio runtime is available, so actual late-contact forking and cancellation are not yet verified.

### 4. Mid-call renegotiation

Section: SIP dialog routing and SDP relay.

- `services/sip/kamailio/kamailio.cfg:192` handles known-dialog requests before new-call INVITE authorization. A re-INVITE no longer re-enters initial extension routing with its remote Contact URI.
- Loose-route and tracked-dialog checks reject unknown dialogs. SDP-bearing re-INVITE, UPDATE, PRACK, and ACK follow the established media route.
- `services/sip/kamailio/kamailio.cfg:602` and `:610` select SDP conversion for the receiving side. FreeSWITCH-facing RTP and app-facing WebRTC are distinguished in both directions.

Validation: routing-order/security structural tests, plus a client test verifying an ICE-restart offer is sent within the existing session. Successful on-wire re-INVITE/200/ACK and two-way RTP after migration are still required.

### 5. Native Answer before INVITE

Section: shared mobile SIP binding, native CallKit/Telecom, and secure bootstrap.

- `mobile/src/features/calling/engine/callUi.ts:97` tracks pending answers by call ID. Answer waits for the matching INVITE, executes accept once, and only completes the native action after SIP accept succeeds.
- Cancellation, expiry, duplicate Answer, and late INVITE/push events cannot resurrect a locally ended call. Native Answer has a bounded 12-second deadline; unanswered native wake screens also expire.
- `mobile/native/ios/VocivoSipCallManager.swift:151` and `:271` retain the CallKit answer action instead of immediately fulfilling it. Android likewise does not mark the connection active at button press.
- `mobile/index.js:6` installs the native/SIP event binding before the visual App is loaded. Native launch events flush only after all JS listeners are attached.
- `mobile/src/features/calling/runtime/sipNative.ts:45` shares a single-flight bootstrap across foreground and background paths. Cached SIP credentials are bound to the current authenticated session in SecureStore, rejected near expiry, and invalidated on logout. Concurrent logout cannot complete a stale registration.
- Cached session access uses after-first-unlock, device-only Keychain storage so a previously unlocked, now locked iPhone can resume a call. A device freshly rebooted and never unlocked is not promised to receive authenticated calls.

Validation: mobile unit races, mounted integration tests, iOS simulator compilation and Android Kotlin compilation. Successful SIP accept/native action completion is not evidence of bidirectional RTP, and no physical PushKit call was tested here.

### 6. Android background UI and startup

Section: native ConnectionService, Expo plugin, and JS entry point.

- `mobile/native/android/VocivoConnection.kt:31` supplies the self-managed incoming-call notification rather than relying on Telecom to draw it.
- New `VocivoSipCallNotification.kt` and `VocivoSipCallActivity.kt` implement Answer/Decline, lock-screen presentation, microphone permission handling, and silent active-call notification state. Full-screen presentation respects OS permission availability.
- `VocivoSipIncomingCall.kt:31` starts a phone-call foreground service and headless SIP bootstrap. `VocivoSipWakeService.kt` separates bootstrap-task lifetime from active-call service lifetime.
- `mobile/index.js:7` registers the real headless task. `mobile/plugins/withVocivoSip.js` includes the new source files, permissions, services, activity, and non-exported action receiver in generated builds.
- Signed-out, expired, duplicate, cancelled, and failed-start calls are rejected or cleaned up. The last ended call removes notifications and stops the foreground service.

Validation: generated Android native project compiled successfully; JS integration exercises secure-cache recovery and startup races. Actual FCM delivery, OEM background restrictions, locked-screen Answer, and notification permissions require physical Android testing. Android Settings force-stop is not equivalent to a process being killed and is not promised to work.

### 7. Web ghost call screen

Section: web SIP session and React calling hook.

- `frontend/src/features/calling/engine/sipCallHealth.js:2` tracks signaling and ICE/peer-connection health with explicit listener removal and bounded recovery deadlines.
- A temporary outage can recover without dropping healthy media. Failed ICE can request one serialized re-INVITE; unrecovered signaling/media clears the call after the 12-second grace window.
- `frontend/src/features/calling/hooks/useSipVoice.js:130` clears local call references, timer source, ringtone and media tracks before awaiting BYE/cancel. A hanging signaling promise cannot keep the active screen indefinitely.
- Late session events cannot restore the ended screen, and peer/session listeners are removed on teardown.

Validation: unit tests plus a browser regression using the real React hook. The browser test drops its mocked signaling transport while BYE never resolves, then verifies the call screen clears, the peer closes, and listeners are removed. This is not a real carrier/RTP call.

## Completed Local Checks

| Check | Result |
| --- | --- |
| `bash verify.sh` | Pass |
| Backend API TypeScript | Pass |
| Backend/frontend automated tests | 304 passed |
| Web production build | Pass |
| Mobile TypeScript | Pass |
| Mobile unit tests | 102 passed |
| Mobile Jest integration | 12 passed, 3 suites |
| `frontend/scripts/test-sip-ui.mjs` | 6 browser scenarios passed |
| `frontend/scripts/test-web-startup.mjs` | 8 browser scenarios passed |
| Android `:app:compileDebugKotlin --offline` | Pass |
| iOS unsigned Debug simulator `xcodebuild` | Pass |
| Updated iOS build installed/launched on dedicated simulator | Sign-in screen rendered; startup fatal-error log query returned no matching entries |
| Focused final SIP config/media-health rerun | 8 passed |
| `git diff --check` | Pass |

The local web app was also opened and its sign-in screen inspected at `http://127.0.0.1:5183/`. Browser fixtures do not place customer calls.

Follow-up runtime check: installed the unsigned build on the dedicated `Vocivo iPhone 17 Pro` simulator (iOS 26.5), loaded the current JavaScript bundle from the existing local Metro server, dismissed the development menu, and inspected the actual Vocivo sign-in screen. No credentials were entered and no calls were placed. This verifies app startup only, not authenticated SIP registration, PushKit delivery, or audio.

Logs: `/tmp/vocivo-seven-fixes-verify.log`, `/tmp/vocivo-seven-fixes-android.log`, and `/tmp/vocivo-seven-fixes-ios.log`. Browser screenshot: `/tmp/vocivo-sip-ui-qa.png`.

The mobile test runner needed one test-only Babel dynamic-import transform. Production Metro imports were not converted. Native source generation and compilation were performed locally; these changes need new native app builds, not only a web deployment or JS update.

## Remaining Release Gates

1. On a staging Linux/container host, render the exact production configuration and run the existing entrypoint with `KAMAILIO_CHECK_ONLY=1`. Docker/Kamailio are unavailable locally. Confirm TSILO/dialog modules exist in the deployed image before any service restart.
2. Stage fresh realm-sensitive registration for all test clients. Validate current contacts and late contacts, registrations at 9/20/40 seconds, multiple devices, caller CANCEL during wake, simultaneous answers, and transaction expiry. Capture the SIP exchange and ensure no native ghost rings remain.
3. Attempt another tenant's REGISTER and conference entry over real SIP; verify denial and unchanged registrar state. Test actual Postgres replay conflicts and legitimate UDP retransmissions.
4. Test hold/resume and Wi-Fi-to-cellular migration with two-way audio on web, iOS, and Android. Require an actual re-INVITE/200/ACK exchange and media counters; mocks cannot establish audio quality or latency.
5. Install fresh iOS/Android builds and test background/process-killed push, Answer before INVITE, remote CANCEL during Answer, denied microphone/full-screen permissions, logout, and expiry. Verify notifications and foreground services stop with the last call.
6. Preserve the conference/REFER deny policy until tenant-authorized admission is implemented and tested.

## Other Open Items

- The production build still reports a large vendor bundle warning (approximately 907 KB versus a 700 KB warning threshold). It was not suppressed.
- npm reported 23 existing mobile dependency advisories (14 moderate, 9 high) during the dev-tool install. This targeted change does not remediate or clear that dependency-security gate.
- Native dependencies emit existing deprecation/build warnings.
- Audible extension-unavailable announcements and other issues outside these seven findings are not implemented or claimed resolved by this pass.
- No commit, push, Vercel deployment, SIP-host deployment, TestFlight upload, or APK distribution was performed.
