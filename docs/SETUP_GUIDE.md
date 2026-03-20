# CallGlobe Setup Guide

## Stack

- Frontend: React 18 + Vite
- Backend: Supabase Auth, Postgres, Edge Functions
- Calling: Twilio Voice SDK + Twilio webhooks
- Payments: Stripe Checkout + Stripe webhooks

## 1. Supabase

Create a Supabase project and apply all migrations from `backend/supabase/migrations/`.

Preferred:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Manual fallback:

1. Run `001_initial.sql`
2. Run `002_security_and_runtime_hardening.sql`
3. Run `003_remove_promotional_signup_credit.sql`

## 2. Edge Functions

Deploy all runtime functions:

```bash
supabase functions deploy create-checkout
supabase functions deploy twilio-token
supabase functions deploy webhook-stripe
supabase functions deploy webhook-twilio
```

## 3. Required Secrets

Set these in Supabase Edge Function secrets:

```text
APP_BASE_URL=https://your-app-domain.example
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_SERVICE_ROLE_KEY=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_AUTH_TOKEN=...
TWILIO_CALLER_ID=+1XXXXXXXXXX
TWILIO_TWIML_APP_SID=AP...
```

## 4. Frontend Env

Create `frontend/.env.local` from `frontend/.env.example`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_APP_URL=http://localhost:3000
```

## 5. Stripe

Create a webhook endpoint:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/webhook-stripe
```

Subscribe to:

- `checkout.session.completed`

## 6. Twilio

Configure your TwiML App / Voice webhook to use:

```text
https://YOUR_PROJECT.supabase.co/functions/v1/webhook-twilio
```

The same function handles TwiML generation and signed status callbacks.

## 7. Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

## 8. Production Notes

- `APP_BASE_URL` must match the public app origin used for Stripe return URLs.
- Twilio webhook signature verification requires `TWILIO_AUTH_TOKEN`.
- Stripe credits are deduplicated by checkout session on the backend.
- Call charging is finalized server-side from the provider call SID, not client-supplied IDs.
