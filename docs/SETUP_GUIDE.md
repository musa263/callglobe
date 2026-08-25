# Vocivo Test and Deployment Guide

## Current Stack

- Native app: React Native, Expo development builds, Telnyx React Native Voice SDK
- Web app: React, Vite, Telnyx WebRTC SDK
- Backend: Vercel Functions
- Authentication: signed Vocivo sessions
- Calling provider: Telnyx

Vocivo does not require Supabase, Twilio, or Stripe for its current calling flow.

## Test the Web App

Run it locally:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in Chrome, Edge, or Safari.

1. Select **Preview interface** to test responsive layout, caller-ID selection, keypad, rates, call history, and settings without placing calls.
2. Sign in with the Vocivo owner account for a live test.
3. Wait until the status says **Ready for calls**.
4. Select the outgoing number, enter a complete international destination, and select **Call now**.
5. Allow microphone access when the browser asks.
6. Call the owned Telnyx number from another phone while the web app is open to test incoming calls.

To use another number as outgoing caller ID, open **Settings**, add the complete number under **Verified caller IDs**, select SMS or voice verification, and enter the code sent by Telnyx. A verified external number is for outgoing caller ID only; receiving calls in Vocivo requires a Telnyx-owned number assigned to the Vocivo connection.

Use headphones during two-way audio tests to prevent echo. Browser incoming calls work while the signed-in page is open. A closed browser cannot receive a normal WebRTC call like a native push-enabled app can.

## Test the Native App on iPhone

Expo Go cannot load the native Telnyx, CallKit, PushKit, or WebRTC modules. Use a development build on a physical iPhone:

```bash
cd mobile
npm install
npx expo prebuild
npx eas build --profile development --platform ios
```

Install the development build from the EAS link, then run:

```bash
npm start
```

Test these flows:

1. Sign in and confirm the owned number appears under **Calling from**.
2. Call a second phone and verify it displays the selected Vocivo number.
3. Keep Vocivo open and call the owned Telnyx number from a second phone.
4. Answer, mute, hold, resume, and end the call.
5. Repeat on Wi-Fi and mobile data.
6. Confirm audio returns after locking and unlocking the phone during an active call.

## TestFlight

Before the first EAS build, replace `REPLACE_WITH_EAS_PROJECT_ID` in `mobile/app.json` by running:

```bash
cd mobile
npx eas init
```

Build and submit:

```bash
npx eas build --profile production --platform ios
npx eas submit --platform ios
```

TestFlight requires an Apple Developer account, a valid App Store Connect app, signing certificates, and provisioning profiles. Reliable incoming calls while the app is backgrounded also require an APNs VoIP credential attached to the Vocivo Telnyx SIP connection. Android background calls require an FCM credential on the same connection.

## Vercel Configuration

The linked Vercel project requires:

```text
APP_ADMIN_EMAIL=...
APP_ADMIN_NAME=...
APP_PASSWORD_HASH=...
AUTH_SECRET=...
TELNYX_API_KEY=KEY...
TELNYX_CONNECTION_ID=...
TELNYX_CREDENTIAL_ID=...
```

Deploy the web app and API together:

```bash
cd frontend
npm run build
npm run check:api
npx vercel --prod
```

## Release Checks

```bash
cd frontend
npm run build
npm run check:api

cd ../mobile
npm run typecheck
```

For the first real call, use a low-cost destination and keep it brief. Telnyx charges begin when the destination answers.
