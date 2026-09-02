# Vocivo native SIP for mobile — implementation spec

Status: proposed · Companion to ADR 0003 / ADR 0004 · Not started

## Why this exists

`VOCIVO_VOICE_EDGE=sip` moves web calls onto the Vocivo SIP edge, but mobile ignores the flag:
`mobile/plugins/withVocivoSip.js` is a no-op placeholder, no `VocivoSip` native module exists, so
`shouldUseSipNative()` is always false and the app falls back to the Telnyx SDK. Until this ships, every
mobile call is still a Telnyx platform leg. This document is the contract the native work must meet so the
existing JS, server and edge pieces fit without rework.

## What already exists

| Layer | Piece | State |
|---|---|---|
| JS | `src/lib/sipNative.ts` — `register / unregister / invite / hangup` over `NativeModules.VocivoSip` | done, 29 lines, no event contract |
| JS | `src/lib/voiceEdge.ts` — `voiceEdgeFromConfig`, `shouldUseSipNative` | done, tested |
| JS | `src/voice/useVoiceRegistration.ts` — fetches `/api/voice/sip-credentials` and calls `registerVocivoSip` when the edge is `sip` and the module is linked | done |
| Server | `/api/voice/sip-credentials` — per-extension digest credentials (1 h) | done |
| Server | `/api/voice/sip-auth` — Kamailio REGISTER/INVITE digest check | done |
| Server | `/api/voice/devices` + `push-device-store` — stores APNs/FCM tokens per extension | done |
| Server | `/api/voice/sip-wakeup` — called by Kamailio when no contact is registered | **web push only**; lists mobile devices, does not push to them |
| Edge | Kamailio forks registered contacts; FreeSWITCH bridges E.164 to the trunk; API-driven inbound (ADR 0004) | done |
| Native | `VocivoSip` module (iOS, Android), CallKit / ConnectionService, PushKit / FCM handling | **missing** |

## Scope of the work

### 1. Server: mobile wakeup dispatch (small, do first — it is testable here)

Extend `/api/voice/sip-wakeup` to actually wake devices, not just list them:

- iOS: send an APNs **VoIP push** (PushKit, topic `<bundleId>.voip`) using the existing `APNS_*` env
  (key id, team id, auth key) to every `platform: 'ios'` token for the extension. Payload:
  `{ "vocivo": { "callId", "callerName", "callerNumber", "sipUsername", "expiresAt" } }`.
- Android: send an FCM **high-priority data** message with the same payload.
- Return which devices were pushed; keep the existing web push behaviour.
- Tokens that APNs/FCM report as invalid are deleted from `push-device-store` (same pattern as 404/410 in
  `web-push-dispatcher.ts`).

Kamailio already calls this endpoint when a contact is absent; after the device wakes and REGISTERs, Kamailio
re-forks the INVITE. The push must arrive within Kamailio's retry window — measure it on the droplet and set the
INVITE hold timer accordingly (target ≤ 4 s cold start).

### 2. Native module contract (`NativeModules.VocivoSip`)

Keep the four methods `sipNative.ts` already declares and add the incoming-call and state surface the
JS side needs. All methods return Promises; all events go through `NativeEventEmitter`.

Methods

```
register({ username, password, domain, wsUri?, displayName? }): Promise<void>
unregister(): Promise<void>
invite(target: string, headers?: { name; value }[]): Promise<callId>
answer(callId): Promise<void>
hangup(callId?): Promise<void>
hold(callId, on: boolean): Promise<void>
mute(callId, on: boolean): Promise<void>
sendDtmf(callId, digit): Promise<void>
setSpeaker(on: boolean): Promise<void>
reportPushCall({ callId, callerName, callerNumber }): Promise<void>   // iOS: must call CXProvider.reportNewIncomingCall synchronously on VoIP push
```

Events (`VocivoSip.*`)

```
registration   { state: 'none'|'progress'|'ok'|'failed', reason? }
incoming       { callId, callerName, callerNumber, sipUsername }
callState      { callId, state: 'connecting'|'ringing'|'active'|'held'|'ended'|'failed', cause? }
mediaState     { callId, muted, onHold, speaker }
```

The `callState` vocabulary is exactly the ARCHITECTURE.md state machine; terminal states never regress, and the
native side never invents a transition — it mirrors the SIP stack.

### 3. iOS

- Stack: **Linphone SDK (liblinphone)** via SwiftPM. It ships CallKit- and PushKit-aware audio session handling
  and TLS/SRTP; PJSIP is the alternative if the Linphone licence is a problem (GPLv3 / commercial).
- PushKit: on every VoIP push call `reportNewIncomingCall` **before** returning from
  `pushRegistry(_:didReceiveIncomingPushWith:)`. iOS terminates apps that receive a VoIP push and do not report
  a call — this is the single most common way this integration fails.
- CallKit: one `CXProvider`; map `callState` to `CXCallUpdate` / `reportOutgoingCall`; handle
  `CXAnswerCallAction`, `CXEndCallAction`, `CXSetHeldCallAction`, `CXSetMutedCallAction`, `CXPlayDTMFCallAction`.
- Audio: configure `AVAudioSession` only inside `didActivate audioSession`; never start media before CallKit
  activates the session.
- Killed state: push → report call → app launches → `useVoiceRegistration` sees `isLaunchedFromPushNotification`
  and the `bootstrapSession`, registers with the stored credentials (`persistVoiceSession`), Kamailio forks the
  held INVITE, `incoming` fires, CallKit already shows the call. Registration must complete inside the INVITE hold.
- `plugins/withVocivoSip.js` (Expo config plugin): add `voip` background mode and `audio`, link the SDK,
  add `NSMicrophoneUsageDescription`, and register the PushKit delegate in `AppDelegate.swift`.

### 4. Android

- Stack: Linphone SDK (Android AAR) or PJSIP.
- Telecom: a self-managed `ConnectionService` so calls appear in the system UI and survive backgrounding;
  a foreground service with the `phoneCall` type during calls.
- Wake: FCM high-priority data message → `AppFirebaseMessagingService` (exists) → start the connection service,
  register, receive the forked INVITE. Android 12+ needs the full-screen-intent permission for the ringing UI.
- Microphone/notification permissions requested through `callAudioPermission.ts` (exists).

### 5. JS integration (`VoiceContext.tsx`)

- Behind `shouldUseSipNative(edge, NativeModules)`, swap the Telnyx `voipClient` adapter for a `VocivoSip`
  adapter exposing the same `callLifecycle.ts` inputs. `callLifecycle.ts` stays the single authority and needs no
  change; `voiceRecovery.ts` (ICE/media recovery) does not apply to the native stack and is bypassed.
- Fallback rule (unchanged): if the module is not linked, or registration fails within 10 s on launch, use the
  Telnyx SDK and report `voice_edge_fallback` through `telemetry`.

## Acceptance (device-only, per ARCHITECTURE.md quality gates)

1. Killed-state ring: force-quit app, call the extension from PSTN, phone rings via CallKit within 4 s, answers with
   two-way audio.
2. Two-way audio on Wi-Fi and cellular; Wi-Fi ↔ cellular migration mid-call keeps audio.
3. Multi-device: two devices on one extension ring; answering one cancels the other (Kamailio fork cancel).
4. Outbound E.164 via trunk with the tenant caller id; internal ext→ext never leaves the droplet (verify with
   `sngrep` on the edge — no Telnyx signalling).
5. Hold, mute, DTMF, transfer, and a three-way conference from CallKit controls.
6. Lock-screen answer and reject; Bluetooth/speaker routing.
7. Battery: no persistent socket when idle — wake relies on push only.

## Sequencing and risk

Do §1 first: it is server-only, unit-testable, and required for both platforms. Then iOS (PushKit + CallKit is
the hard part and carries the App Store review risk), then Android. Budget device-lab time for §Acceptance; none
of this can be verified without physical devices and the live edge.

Known risks: PushKit report-or-die rule; Kamailio INVITE hold vs cold-start time; SDK licence choice; App Store
review requiring CallKit for VoIP; APNs sandbox vs production token environments (already modelled in
`push-device-store.environment`).
