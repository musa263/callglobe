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
TELNYX_ICE_SERVERS_JSON=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:security@vocivo.com
VITE_APP_URL=https://vocivo.app
```

The Web Push private key is server-only. The browser receives only the VAPID
public key through the authenticated `/api/voice/web-push` endpoint.

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

## Custom domain (`vocivo.app`)

Keep DNS at Namecheap (`dns1.registrar-servers.com` / `dns2.registrar-servers.com`). Add `vocivo.app` and `www.vocivo.app` on the Vercel project **vocivo**, then create these records in Namecheap:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `216.198.79.1` |
| A | `@` | `64.29.17.1` |
| CNAME | `www` | `cname.vercel-dns.com` |

Do not leave only `76.76.21.21` on the apex. Vercel’s current verification expects both `216.198.79.1` and `64.29.17.1`; a lone classic anycast A record can fail SSL issuance and time out on `https://vocivo.app` while `https://www.vocivo.app` still works.

Set the Vercel env `VITE_APP_URL=https://vocivo.app`. Mobile production builds use `EXPO_PUBLIC_API_URL=https://vocivo.app`. Leave `vocivo.vercel.app` attached as a backup. When the SIP droplet exists, add `sip` as an A record to that droplet IPv4.
