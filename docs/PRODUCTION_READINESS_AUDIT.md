# Vocivo Production Readiness Audit

Date: 2026-08-28

## Verdict

Vocivo is **not ready for commercial production**. Foreground extension calling now completes in a controlled two-device Android test, but terminated-app ringing, carrier-grade NAT traversal, real conference mixing, high availability, and physical-device audio verification are still release blockers.

This document separates observed defects from assumptions. A feature is not considered complete merely because its UI exists.

## Release Blockers

### P0 - Terminated and background mobile ringing is unavailable

- The live PBX has both `APNS_ENABLED=false` and `FCM_ENABLED=false`.
- Live incoming-call logs recorded a registered device but `delivered: 0` and `skipped: 1` for push delivery.
- Android has no Firebase Messaging background handler that can receive a data push and report the call to CallKeep.
- The app's `enablePushNotifications()` and `disablePushNotifications()` methods are empty stubs.

**Impact:** a foreground WebSocket can ring, but a terminated app cannot be woken reliably. This is also why ringing can appear device-dependent.

**Release gate:** configure APNs VoIP credentials and FCM credentials, implement the Android background handler, reject stale or logged-out pushes, and pass terminated-app tests on physical iPhone and Android devices.

### P0 - TURN is not configured in production

- The deployed clients have relied on STUN only.
- Authenticated TURN is now configured locally with short-lived HMAC credentials through `VOCIVO_TURN_URLS` and `VOCIVO_TURN_SECRET`, including a TLS-over-443 route, but the production endpoint still needs deployment verification.

**Impact:** calls can connect on friendly Wi-Fi while failing or producing one-way/no audio on carrier networks and symmetric NAT.

**Release gate:** deploy geographically appropriate TURN over UDP, TCP, and TLS; verify relay candidates; test Wi-Fi-to-5G, 5G-to-5G, and restricted enterprise networks.

### P0 - Conference merge needs physical deployment verification

- FreeSWITCH `mod_conference` rooms are now tenant-namespaced, and mobile/web clients transfer connected legs into the PBX room.
- Participant removal and live membership reconciliation still need a PBX control endpoint and physical-device verification.

**Impact:** the Merge control cannot be sold as a working feature.

**Release gate:** verify conference media on physical devices, then complete remove-participant, hangup authorization, and event reconciliation tests.

### P0 - Physical-device audio is not yet verified

- The Android emulator test showed remote track creation, microphone capture, playout initialization, and active call state on both devices.
- Emulators do not prove that a user can hear both directions through iPhone/Android earpiece, speaker, Bluetooth, or interrupted audio sessions.

**Release gate:** complete a physical-device matrix and record objective two-way audio results. CallKit testing must include locked and terminated states.

## High-Severity Risks

### P1 - Web background ringing is session-bound

The web app relies on an open WebSocket and browser notification. Closing the tab removes its call channel; there is no service-worker Web Push wake-up path. The local client now rejects an excess simultaneous invitation with SIP 486 instead of overwriting the visible waiting call, but true queueing still belongs in the PBX.

### P1 - Current PBX capacity is pilot-scale

The configured limits are 50 sessions and 10 sessions per second. A normal two-leg call consumes approximately two FreeSWITCH sessions, giving an order-of-magnitude ceiling of about 25 simultaneous calls before overhead. The 5,000-request HTTP health check is not a 5,000-user voice test.

### P1 - Single-node architecture has no call-service failover

A single PBX/TURN/push event path is a service-wide failure domain. There is no demonstrated redundant SBC, shared registration strategy, database failover, rolling upgrade procedure, or disaster recovery exercise.

### P1 - Production observability is incomplete

The repository contains many swallowed promise failures and silent catches. There is no demonstrated end-to-end correlation ID spanning app, SIP leg, FreeSWITCH UUID, push event, and API request. Operators cannot reliably explain a failed customer call after the fact.

### P1 - Mobile regression coverage is absent

There is no automated mobile test suite for login, registration, incoming call, answer, reject, hangup, audio-route changes, logout, call waiting, transfer, or app termination. This makes call-lifecycle regressions likely.

### P1 - Release dependency and packaging debt

- The mobile dependency audit reports 21 advisories: 9 high and 12 moderate, largely in the Expo 54 toolchain.
- The frontend audit reports 2 moderate advisories through the video dependency chain.
- The Android universal release APK is about 142 MB and contains all four ABIs. Release dependencies also include the Expo development client.
- The main frontend vendor chunk is about 639 KB minified and the PWA precache is about 2.86 MB.

## Confirmed Fixes In This Audit

- Forwarded CallKeep audio-session activation and deactivation to WebRTC's iOS `RTCAudioSession`, while retaining InCallManager routing.
- Added expiring coturn REST credentials, TLS/443 fallback routing, and authenticated STUN/TURN configuration to the API, web client, and mobile client.
- Added focused tests proving temporary TURN credentials and APNs concurrency backpressure.
- Made authentication bootstrap fail closed so an API failure cannot silently grant calling access.
- Added expiry and cleanup for pending native call actions.
- Added the Android foreground microphone permission and `phoneCall|microphone` service declaration.
- Added FreeSWITCH candidate ACL configuration and validation.
- Added tenant-namespaced FreeSWITCH conference routing and PBX-backed client merge flows.
- Rejected excess simultaneous web invitations instead of overwriting an unanswered call.

These fixes are local source changes. They do not make the production deployment or current TestFlight build compliant until deployed and rebuilt.

## Verification Evidence

| Check | Result |
| --- | --- |
| Frontend tests | 72 passed |
| Frontend API contract check | Passed |
| Frontend production build | Passed |
| Mobile TypeScript check | Passed |
| Expo configuration introspection | Passed |
| ESL listener tests | 15 passed |
| FreeSWITCH configuration validation | Passed |
| Android release build | Passed |
| Android release startup, emulator 1 | 566 ms measured |
| Android release startup, emulator 2 | 2.345 s measured |
| Android two-device foreground call | Ring, answer, connected state, media pipeline, and bilateral hangup passed |
| iOS release simulator build | Passed with the final audio-session patch |
| Physical iPhone/Android two-way audio | Not yet verified |
| Terminated-app incoming call | Blocked by APNs/FCM configuration |
| 5,000 concurrent voice users | Not tested and unsupported by current PBX limits |

## Required Release Sequence

1. Deploy TURN and prove relay connectivity before further UI work.
2. Complete APNs VoIP and FCM wake-up flows, including logout token invalidation and stale-call suppression.
3. Implement PBX-owned conference media and remove/hold/transfer reconciliation.
4. Add structured call telemetry and eliminate silent critical-path catches.
5. Add mobile integration tests and a physical-device call matrix.
6. Upgrade and slim release dependencies, then create signed iOS and Android candidates.
7. Run staged voice load tests at 25, 100, 500, and the purchased capacity, including media, registration, push, and failure recovery.
8. Add redundancy and disaster recovery before accepting paying customers.

## Definition Of Ready

Vocivo can be called production-ready only when every P0 item is closed with physical-device evidence, all P1 risks have an accepted remediation or documented operating limit, and the exact signed binaries submitted to TestFlight/Play testing pass the release matrix.
