# Frontend Setup

The frontend is a Vite React app that authenticates with Supabase and starts calls through the Twilio Voice SDK.

## Env

Create `frontend/.env.local`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_APP_URL=http://localhost:3000
```

## Start

```bash
cd frontend
npm install
npm run dev
```

## Required Backend Pieces

The frontend expects these edge functions to be deployed:

- `create-checkout`
- `twilio-token`
- `webhook-stripe`
- `webhook-twilio`

It also expects all SQL migrations in `backend/supabase/migrations/` to be applied.

## Runtime Behavior

- Recharge returns to `/?tab=recharge&success=true` or `/?tab=recharge&canceled=true`.
- Call history and balance refresh from backend state after a call ends.
- Call logs and billing are created server-side from Twilio webhooks.
