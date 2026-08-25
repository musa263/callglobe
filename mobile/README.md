# Vocivo Mobile

Native iOS and Android app built with React Native, Expo development builds, Vercel Functions, and the Telnyx React Native Voice SDK. It does not use Supabase.

## Architecture

- `mobile/`: native application and encrypted device session/history storage
- `api/auth/*`: private owner login and short-lived Vocivo sessions on Vercel
- `api/telnyx/*`: Telnyx balance and Voice SDK JWT endpoints on Vercel
- Telnyx: SIP/WebRTC calling, PSTN routing, APNS, and FCM push delivery

The Telnyx API key is stored only in Vercel environment variables. The mobile app receives temporary, scoped tokens.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `EXPO_PUBLIC_API_URL` to the Vercel deployment URL.
3. Run `npm install`.
4. Run `npx expo prebuild`, then `npm run ios` or `npm run android`.

Expo Go cannot load Telnyx, CallKit, PushKit, or Android phone-call services. Use a development build on a physical device.

## Vercel environment

Configure these variables in the linked `vocivo` Vercel project:

```text
APP_ADMIN_EMAIL=...
APP_ADMIN_NAME=...
APP_PASSWORD_HASH=...
AUTH_SECRET=...
TELNYX_API_KEY=KEY...
TELNYX_CONNECTION_ID=...
TELNYX_CREDENTIAL_ID=...
```

## TestFlight

1. Replace the EAS project ID in `app.json` and confirm the bundle identifier.
2. Run `npx eas build:configure`.
3. Create an iOS VoIP Services certificate for the same bundle identifier.
4. Upload the iOS push credential in Telnyx and attach it to the credential connection.
5. Run `npx eas build --platform ios --profile production`.
6. Run `npx eas submit --platform ios --profile production`.

Test calling and VoIP pushes on a physical iPhone. TestFlight uses the production APNS environment.
