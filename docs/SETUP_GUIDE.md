# CallGlobe — Full Stack VoIP Calling App

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    USER'S PHONE                      │
│               (React PWA / Capacitor)                │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Dialer  │  │ Recharge │  │  Telnyx WebRTC    │  │
│  │   UI     │  │   UI     │  │  SDK (calls)      │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
└───────┼──────────────┼─────────────────┼─────────────┘
        │              │                 │
        ▼              ▼                 ▼
┌───────────────┐ ┌──────────┐  ┌───────────────────┐
│   Supabase    │ │  Stripe  │  │     Telnyx        │
│   Backend     │ │ Checkout │  │   SIP/WebRTC      │
│               │ │          │  │   Gateway         │
│ • Auth        │ └────┬─────┘  └────────┬──────────┘
│ • Users DB    │      │                 │
│ • Balances    │      │                 │
│ • Call Logs   │      ▼                 ▼
│ • Edge Fns    │  Webhook ──────►  Webhook
│               │  (add balance)    (log CDR,
└───────────────┘                   deduct balance)
```

## Prerequisites — Accounts You Need

### 1. Telnyx (Telephony Provider)
- Sign up: https://telnyx.com
- Create a **Credential Connection** (for WebRTC)
- Buy at least one phone number (for caller ID)
- Get your **API Key** from the dashboard
- Note your **SIP Connection ID**
- Estimated cost: ~$1/mo for number + $0.005-0.03/min per call

### 2. Supabase (Backend)
- Sign up: https://supabase.com
- Create a new project
- Get your **Project URL** and **Anon Key** from Settings → API
- Get your **Service Role Key** (for edge functions)

### 3. Stripe (Payments)
- Sign up: https://stripe.com
- Get **Publishable Key** and **Secret Key** from Developers → API Keys
- Create a webhook endpoint pointing to your Supabase edge function

## Setup Steps

### Step 1: Database (Supabase)
Run the SQL migration in `supabase/migrations/001_initial.sql` in your 
Supabase SQL editor (Dashboard → SQL Editor → New Query → Paste & Run).

### Step 2: Edge Functions (Supabase)
Deploy each function in `supabase/functions/` using Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-checkout
supabase functions deploy webhook-stripe
supabase functions deploy webhook-telnyx
supabase functions deploy get-balance
supabase functions deploy deduct-balance
```

### Step 3: Environment Variables
Set these in Supabase Dashboard → Edge Functions → Secrets:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
TELNYX_API_KEY=KEY_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Step 4: Frontend
```bash
cd callglobe
cp .env.example .env.local
# Fill in your keys in .env.local
npm install
npm run dev
```

### Step 5: Stripe Webhook
In Stripe Dashboard → Developers → Webhooks:
- Add endpoint: `https://YOUR_PROJECT.supabase.co/functions/v1/webhook-stripe`
- Select event: `checkout.session.completed`

### Step 6: Telnyx Webhook
In Telnyx Dashboard → your Connection → Webhooks:
- Set URL: `https://YOUR_PROJECT.supabase.co/functions/v1/webhook-telnyx`

### Step 7: Deploy Frontend
```bash
npm run build
# Deploy to Vercel, Netlify, or any static host
```

### Step 8: Mobile App (Optional)
```bash
npx cap init CallGlobe com.callglobe.app
npx cap add android
npx cap add ios
npm run build
npx cap sync
npx cap open android  # or ios
```

## Pricing Model
- You pay Telnyx: ~$0.005-0.03/min (varies by country)
- You charge users: $0.01-0.10/min (set in call_rates table)
- Your margin: 2-5x markup
- Stripe takes: 2.9% + $0.30 per recharge

## File Structure
```
callglobe/
├── docs/
│   └── SETUP_GUIDE.md          ← You are here
├── supabase/
│   ├── migrations/
│   │   └── 001_initial.sql     ← Database schema
│   └── functions/
│       ├── create-checkout/     ← Stripe checkout session
│       ├── webhook-stripe/      ← Handle successful payments
│       ├── webhook-telnyx/      ← Handle call CDRs
│       ├── get-balance/         ← Get user balance
│       └── deduct-balance/      ← Deduct during calls
├── public/
│   └── manifest.json           ← PWA manifest
├── src/
│   ├── components/             ← UI components
│   ├── hooks/                  ← Custom hooks
│   ├── lib/                    ← Supabase, Telnyx, Stripe clients
│   ├── pages/                  ← Screen components
│   └── styles/                 ← Global styles
├── package.json
├── vite.config.js
├── .env.example
└── index.html
```
