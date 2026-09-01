# Vocivo Mobile

Native iOS and Android app built with React Native, Expo development builds, the Telnyx Voice SDK, CallKit/PushKit, and Firebase Cloud Messaging. It does not use Supabase.

## Architecture

- `mobile/`: native application and encrypted device session/history storage
- `api/auth/*`: private owner login and short-lived Vocivo sessions on Vercel
- `/api/telnyx/token`: short-lived, tenant-scoped Telnyx WebRTC authentication
- `/api/voice/devices`: device metadata used by the authenticated application
- Telnyx WebRTC: SIP/WebRTC media, native incoming-call push delivery, and PSTN routing
- Vocivo API: SaaS tenancy, extensions, call policy, voicemail, conference, and messaging orchestration

SIP passwords and carrier keys remain server-side. The app receives a short-lived token and Telnyx ICE configuration for its signed-in extension.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `EXPO_PUBLIC_API_URL` to `https://vocivo.app`.
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
TELNYX_PUBLIC_KEY=...
TELNYX_CONNECTION_ID=...
TELNYX_CREDENTIAL_ID=...
TELNYX_ICE_SERVERS_JSON=
```

## TestFlight

1. Replace the EAS project ID in `app.json` and confirm the bundle identifier.
2. Run `npx eas build:configure`.
3. Configure the iOS and Android push credentials on the Telnyx Credential Connection.
4. Run `npx eas build --platform ios --profile production`.
5. Run `npx eas submit --platform ios --profile production`.

Test calling and VoIP pushes on a physical iPhone. TestFlight uses the production APNS environment.
