# Vocivo

Vocivo is a mobile-first business phone platform. React Native/Expo powers iOS and Android; React/Vite powers the web phone and administration. Vercel Functions and PostgreSQL provide the shared control plane. Calling uses either the configured Vocivo SIP edge or Telnyx managed engine.

New engineers should begin with the [feature directory and troubleshooting paths](docs/FEATURES.md), then [ARCHITECTURE.md](ARCHITECTURE.md). Development rules and required checks are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Apps

- `mobile/`: iOS and Android app, with feature modules under `src/features/`
- `frontend/`: responsive web phone and Vercel API
- `docs/SETUP_GUIDE.md`: local, device, and TestFlight testing steps
- `docs/SIP_TRUNKING.md`: current hosting and dedicated SIP edge requirements
- `docs/ESIM_INTEGRATION.md`: travel-data provider decision and production boundary

## Web Quick Start

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite. Sign in through a configured local API or a testing deployment. Vite alone serves the UI, not Vercel Functions. There is no customer-facing simulated calling mode; automated transport fixtures exist only in test harnesses.

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
./verify.sh
```

The non-billable HTTP capacity check is available at `frontend/scripts/load-test.mjs`. It does not place carrier calls. `/api/health` measures cached control-plane liveness; use `/api/health?deep=1` only for low-concurrency database diagnostics.

Platform/carrier keys stay on the backend. The SIP API issues a temporary device credential to authenticated clients; it must never expose shared trunk secrets. Never put server secrets in Expo public variables or frontend build variables.
