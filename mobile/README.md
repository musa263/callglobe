# Vocivo Mobile

Native iOS and Android app built with React Native, Expo development builds, SIP.js, CallKit/PushKit, and the Vocivo FreeSWITCH media plane. It does not use Supabase.

## Architecture

- `mobile/`: native application and encrypted device session/history storage
- `api/auth/*`: private owner login and short-lived Vocivo sessions on Vercel
- `/api/voice/config`: short-lived, authenticated Vocivo SIP configuration
- `/api/voice/devices`: device registration for incoming-call fan-out
- FreeSWITCH/Sofia: extension registration, SIP/WebRTC media, internal calls, voicemail, and conferences
- Vocivo ESL listener: call events plus direct APNs VoIP and FCM push delivery
- Telnyx or another carrier: optional PSTN numbers, external calling, and SMS only

SIP passwords, carrier keys, and push credentials remain server-side. The app receives only the authenticated extension configuration for its signed-in user.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `EXPO_PUBLIC_API_URL` to the Vercel deployment URL.
3. Run `npm install`.
4. Run `npx expo prebuild`, then `npm run ios` or `npm run android`.

Expo Go cannot load CallKit, PushKit, WebRTC, or Android phone-call services. Use a development build on a physical device.

## Vercel environment

Configure these variables in the linked `vocivo` Vercel project:

```text
APP_ADMIN_EMAIL=...
APP_ADMIN_NAME=...
APP_PASSWORD_HASH=...
AUTH_SECRET=...
TELNYX_API_KEY=KEY...
VOCIVO_PBX_ENGINE=freeswitch
VOCIVO_SIP_DOMAIN=sip.68.183.244.215.nip.io
VOCIVO_SIP_WSS_URL=wss://sip-wss.68.183.244.215.nip.io
VOCIVO_WEBHOOK_SECRET=...
```

## TestFlight

1. Replace the EAS project ID in `app.json` and confirm the bundle identifier.
2. Run `npx eas build:configure`.
3. Create an Apple APNs token key that can send VoIP pushes for the same team and bundle identifier.
4. Mount the `.p8` key on the Vocivo PBX and configure `APNS_*` in `services/pbx/.env`.
5. Run `npx eas build --platform ios --profile production`.
6. Run `npx eas submit --platform ios --profile production`.

Test calling and VoIP pushes on a physical iPhone. TestFlight uses the production APNS environment.
