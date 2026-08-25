# Vocivo

Vocivo is a mobile and web VoIP phone built on Telnyx. The native app uses React Native and Expo; the browser phone uses React, Vite, and the Telnyx WebRTC SDK. Both clients share a Vercel Functions backend and do not use Supabase.

## Apps

- `mobile/`: iOS and Android app with native Telnyx voice support
- `frontend/`: responsive web phone and Vercel API
- `docs/SETUP_GUIDE.md`: local, device, and TestFlight testing steps

## Web Quick Start

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Use **Preview interface** to inspect the complete UI without connecting to Telnyx or placing a call.

## Mobile Quick Start

```bash
cd mobile
npm install
npx expo prebuild
npm run ios
```

Use an Expo development build, not Expo Go. Telnyx, CallKit, PushKit, and WebRTC require native modules.

## Checks

```bash
cd frontend && npm run build && npm run check:api
cd mobile && npm run typecheck
```

The Telnyx API key and SIP credentials are held by the Vercel backend. Never place them in Expo public variables or frontend build variables.
