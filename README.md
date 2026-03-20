# CallGlobe

CallGlobe is a React + Supabase calling app with Twilio Voice for browser calling and Stripe Checkout for balance top-ups.

## Repository Layout

```text
callglobe-Codex/
├── backend/
│   └── supabase/
│       ├── functions/
│       │   ├── create-checkout/
│       │   ├── twilio-token/
│       │   ├── webhook-stripe/
│       │   └── webhook-twilio/
│       └── migrations/
│           ├── 001_initial.sql
│           ├── 002_security_and_runtime_hardening.sql
│           └── 003_remove_promotional_signup_credit.sql
├── design/
├── docs/
├── frontend/
│   ├── public/
│   └── src/
└── ARCHITECTURE.md
```

## Quick Start

1. Create a Supabase project.
2. Apply every SQL migration in `backend/supabase/migrations/` in order, or run `supabase db push`.
3. Deploy the Supabase edge functions:
   - `create-checkout`
   - `twilio-token`
   - `webhook-stripe`
   - `webhook-twilio`
4. Set the required backend secrets:
   - `APP_BASE_URL`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_API_KEY_SID`
   - `TWILIO_API_KEY_SECRET`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_CALLER_ID`
   - `TWILIO_TWIML_APP_SID`
5. Configure `frontend/.env.local` from `frontend/.env.example`.
6. Run the frontend:

```bash
cd frontend
npm install
npm run dev
```

## Notes

- Stripe credits are now processed idempotently on the backend.
- Twilio webhooks are signature-verified and call charging is finalized server-side.
- The app expects checkout return URLs to resolve back to `/?tab=recharge`.

See [docs/SETUP_GUIDE.md](/Users/musausman/Desktop/CLAUDE%20APPS%20PROJECTS/callglobe-Codex/docs/SETUP_GUIDE.md) for the deployment checklist.
