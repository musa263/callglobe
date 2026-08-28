# Vocivo Web and API Setup

The `frontend` directory contains the Vite web phone, React admin console, and Vercel Functions API. It uses Telnyx and does not require Supabase or Twilio.

## Local web app

```bash
cd frontend
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Required server environment

Configure these as Vercel server secrets. Do not expose Telnyx credentials through `VITE_` variables.

```text
APP_ADMIN_EMAIL=
APP_ADMIN_NAME=
APP_PASSWORD_HASH=
AUTH_SECRET=
BLOB_READ_WRITE_TOKEN=
TELNYX_API_KEY=
TELNYX_CONNECTION_ID=
TELNYX_CREDENTIAL_ID=
TELNYX_CALL_CONTROL_APP_ID=
TELNYX_PSTN_CONNECTION_ID=
TELNYX_PHONE_NUMBER_ID=
TELNYX_SIP_URI=
TELNYX_SMS_FROM=
TELNYX_PUBLIC_KEY=
VOCIVO_PBX_ENGINE=freeswitch
VOCIVO_SIP_DOMAIN=
VOCIVO_SIP_WSS_URL=wss://sip-wss.example.com
VOCIVO_STUN_URLS=stun:stun.cloudflare.com:3478
VOCIVO_TURN_URLS=turn:turn.68.183.244.215.nip.io:3478?transport=udp,turn:turn.68.183.244.215.nip.io:3478?transport=tcp,turns:turn.68.183.244.215.nip.io:443?transport=tcp
VOCIVO_TURN_SECRET=
VOCIVO_TURN_TTL_SECONDS=600
VITE_APP_URL=https://vocivo.vercel.app
```

Optional voice-generation and payment integrations have their own server-side keys. The app falls back to carrier voice synthesis when the configured Vocivo voice provider is unavailable.

## Verification

```bash
cd frontend
npm run check:api
npm run build
node --test --import tsx api/_lib/*.test.ts
```

Deploy the web app and API together:

```bash
npx vercel --prod
```
