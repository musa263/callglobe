# Call push

## Telnyx

When `VOCIVO_VOICE_EDGE` is `telnyx`, incoming-call wakeups are owned by Telnyx:

- iOS uses the PushKit token supplied in the Telnyx login configuration.
- Android uses the Firebase Cloud Messaging token supplied in the Telnyx login configuration.
- The app passes Telnyx push data directly to the Telnyx SDK.

## Vocivo SIP VoIP

When the SIP edge is on, missed contacts call `POST /api/voice/sip-wakeup`. That endpoint:

1. Sends web push for desktop.
2. Sends an APNs **VoIP** notification to every iOS token stored on `POST /api/voice/devices`.
3. Stores a CallKit UUID shared by the push, the `X-Vocivo-Call-UUID` INVITE header, and native CallKit.

The iPhone keeps a **single** `PKPushRegistry`. Vocivo payloads include `"vocivo":"sip"`. Those are handled by `VocivoSipPush` (CallKit first, then SIP REGISTER). Everything else still goes to Telnyx.

Answering on one device posts `{ action: "answered" }` so the other devices get a cancel VoIP push with the same UUID. SIP CANCEL still applies to contacts that already received the INVITE.

Configure on Vercel:

```text
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_AUTH_KEY=
APNS_TOPIC=app.vocivo.mobile.voip
```

`APNS_AUTH_KEY` is the `.p8` contents (or the base64 body). The key must be allowed for VoIP on `app.vocivo.mobile`.

## Device checks

Validate on physical iPhones after a native TestFlight that includes this AppDelegate intercept:

1. Two devices, same extension: both ring; answer on one, the other CallKit UI clears.
2. App foregrounded, backgrounded, terminated, and phone locked.
3. Sign out, terminate, confirm the former account does not ring.
4. Wi-Fi and cellular.
