# CallGlobe — ARCHITECTURE.md

## Global VoIP Calling Application

**Version 1.0 | March 2026**

---

## 1. PROJECT STRUCTURE

```
callglobe-complete/
│
├── ARCHITECTURE.md                          ← This file
├── README.md                                ← Project overview & quick start
│
├── docs/                                    ← Documentation
│   ├── CallGlobe-PRD.docx                  ← Full Product Requirements Document
│   ├── callglobe-launch-checklist.docx      ← Step-by-step launch checklist
│   └── SETUP_GUIDE.md                       ← Technical setup & deployment guide
│
├── design/                                  ← UI/UX Design
│   └── UI-Design-Spec.md                   ← Colors, typography, components, screen flows
│
├── frontend/                                ← Frontend Application (React PWA)
│   ├── index.html                          ← HTML entry point
│   ├── package.json                        ← Dependencies & scripts
│   ├── vite.config.js                      ← Vite build configuration
│   ├── .env.example                        ← Environment variables template
│   ├── public/
│   │   └── manifest.json                   ← PWA manifest
│   ├── src/
│   │   ├── main.jsx                        ← React entry point
│   │   ├── App.jsx                         ← Production app (Supabase + Twilio)
│   │   ├── App-Prototype.jsx               ← Interactive prototype (standalone)
│   │   ├── components/
│   │   │   ├── CountryPicker.jsx           ← Country selection modal
│   │   │   ├── Header.jsx                  ← App header with user avatar
│   │   │   └── TabBar.jsx                  ← Bottom navigation (5 tabs)
│   │   ├── hooks/
│   │   │   ├── useAuth.js                  ← Authentication state management
│   │   │   └── useTwilio.js                ← WebRTC calling engine hook
│   │   ├── lib/
│   │   │   ├── supabase.js                 ← Supabase client + API functions
│   │   │   └── twilio.js                   ← Twilio Voice SDK wrapper
│   │   ├── pages/
│   │   │   ├── SplashScreen.jsx            ← Animated splash (2s)
│   │   │   ├── AuthScreen.jsx              ← Login / Signup
│   │   │   ├── DialerScreen.jsx            ← Main dialer with keypad
│   │   │   ├── ActiveCallScreen.jsx        ← In-call UI (timer, controls)
│   │   │   ├── HistoryScreen.jsx           ← Call history log
│   │   │   ├── RatesScreen.jsx             ← Country rate browser
│   │   │   └── RechargeScreen.jsx          ← Balance top-up via Stripe
│   │   └── styles/
│   │       └── global.css                  ← Global styles + animations
│   └── docs/
│       └── SETUP_GUIDE.md                  ← Frontend-specific setup
│
└── backend/                                 ← Backend (Supabase)
    └── supabase/
        ├── migrations/
        │   ├── 001_initial.sql             ← Base database schema + seed data
        │   ├── 002_security_and_runtime_hardening.sql
        │                                    ← RPC hardening, Stripe idempotency,
        │                                      Twilio billing safety
        │   └── 003_remove_promotional_signup_credit.sql
        │                                    ← Removes legacy signup credit defaults
        └── functions/
            ├── create-checkout/
            │   └── index.ts                ← Stripe checkout session creator
            ├── webhook-stripe/
            │   └── index.ts                ← Payment success → add balance
            ├── twilio-token/
            │   └── index.ts                ← Twilio access token generator
            └── webhook-twilio/
                └── index.ts                ← Call events → log CDR, deduct balance
```

---

## 2. HIGH-LEVEL SYSTEM DIAGRAM

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER'S DEVICE                            │
│                  (React PWA / Capacitor Native)                  │
│                                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│   │  Dialer  │  │ Recharge │  │  History  │  │ Twilio Voice  │  │
│   │  Screen  │  │  Screen  │  │  Screen   │  │ SDK (voice)   │  │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
└────────┼──────────────┼─────────────┼────────────────┼──────────┘
         │              │             │                │
         ▼              │             │                ▼
┌─────────────────┐     │             │     ┌──────────────────────┐
│    Supabase     │     │             │     │     Twilio Cloud     │
│    Platform     │     │             │     │                      │
│                 │     │             │     │  ┌────────────────┐  │
│  ┌───────────┐  │     │             │     │  │  SIP / WebRTC  │  │
│  │   Auth    │◄─┼─────┼─────────────┘     │  │   Gateway      │  │
│  │  (JWT)    │  │     │                   │  └───────┬────────┘  │
│  └───────────┘  │     │                   │          │           │
│  ┌───────────┐  │     │                   │          ▼           │
│  │ PostgreSQL│  │     │                   │  ┌────────────────┐  │
│  │    DB     │  │     │                   │  │  PSTN Network  │  │
│  │           │  │     │                   │  │ (Global Phone  │  │
│  │ •profiles │  │     │                   │  │   Numbers)     │  │
│  │ •call_logs│  │     │                   │  └────────────────┘  │
│  │ •call_rate│  │     │                   │                      │
│  │ •transact.│  │     │                   │  Webhooks ──────┐    │
│  │ •referrals│  │     │                   └────────────────┼────┘
│  │ •packages │  │     │                                    │
│  └───────────┘  │     │                                    │
│  ┌───────────┐  │     │         ┌──────────────┐           │
│  │   Edge    │◄─┼─────┼─────────│    Stripe    │           │
│  │ Functions │  │     │         │   Payments   │           │
│  │ (Deno)    │◄─┼─────┘         │              │           │
│  │           │◄─┼───────────────│  Webhook ────┤           │
│  │           │◄─┼───────────────┼──────────────┘           │
│  │           │◄─┼──────────────────────────────────────────┘
│  └───────────┘  │
└─────────────────┘

      ┌──────────────┐
      │   Vercel     │  ← Frontend hosting (CDN)
      │   Hosting    │
      └──────────────┘
```

**Data Flow Summary:**
1. **User → Frontend**: React PWA with dark-mode UI, dialer, recharge, history
2. **Frontend → Supabase**: Auth (JWT), database reads/writes, edge function calls
3. **Frontend → Twilio**: WebRTC voice calls directly from browser/native app
4. **Twilio → PSTN**: Routes calls to any phone number worldwide
5. **Stripe → Supabase**: Webhook on payment success → adds balance
6. **Twilio → Supabase**: Signed webhooks log CDRs and finalize charging

---

## 3. CORE COMPONENTS

### 3.1 Frontend — React PWA + Capacitor

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Mobile-first VoIP calling interface |
| **Technologies** | React 18, Vite 5, React Router 6, Twilio Voice SDK |
| **Deployment** | Vercel (static hosting with CDN) |
| **Native Wrapper** | Capacitor (iOS + Android app store builds) |
| **Design** | Dark-mode-first, DM Sans typography, #00D4AA primary accent |

**Key Screens:**
- **Dialer** — Keypad, country picker, balance card, caller ID selector
- **Active Call** — Timer, mute/speaker/keypad controls, end call
- **History** — Chronological CDR list (inbound/outbound)
- **Recharge** — Tier cards ($10–$100), Stripe Checkout integration
- **Invite** — Referral code, WhatsApp/SMS share, stats

### 3.2 Backend — Supabase Platform

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Auth, database, serverless functions, realtime |
| **Technologies** | Supabase (PostgreSQL, Auth, Edge Functions on Deno, Realtime) |
| **Deployment** | Supabase Cloud (managed) |

**Edge Functions:**
| Function | Trigger | Purpose |
|----------|---------|---------|
| `create-checkout` | User taps recharge | Creates Stripe Checkout session with validated return URLs |
| `twilio-token` | Twilio device boot | Generates access tokens for the authenticated user |
| `webhook-stripe` | `checkout.session.completed` | Idempotently credits balance from the checkout session |
| `webhook-twilio` | Call events (initiated, answered, hangup) | Verifies Twilio signatures, logs calls, finalizes billing |

### 3.3 Telephony — Twilio Voice + PSTN

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Voice calling engine (browser-to-phone) |
| **Technologies** | Twilio Voice SDK (`@twilio/voice-sdk`), TwiML App, Voice webhooks |
| **Features** | Outbound calls, inbound calls (DID), caller ID selection |
| **Encryption** | SRTP/DTLS (end-to-end encrypted) |

### 3.4 Payments — Stripe Checkout

| Attribute | Detail |
|-----------|--------|
| **Purpose** | PCI-compliant card payments for balance recharge |
| **Technologies** | Stripe Checkout (hosted), `@stripe/stripe-js`, Stripe Webhooks |
| **Flow** | Frontend → Edge Function → Stripe Session → Redirect → Webhook → Balance |

---

## 4. DATA STORES

### 4.1 PostgreSQL (Supabase)

Primary relational database. All tables have Row Level Security (RLS) enabled.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts (extends `auth.users`) | `id`, `email`, `full_name`, `balance`, `referral_code`, `referred_by` |
| `call_rates` | Per-minute rates by country | `country_code`, `dial_code`, `rate_per_min`, `cost_per_min`, `flag` |
| `recharge_packages` | Available recharge tiers ($10–$100) | `amount`, `credit`, `bonus_percent`, `stripe_price_id` |
| `transactions` | All balance changes (recharge + deductions) | `user_id`, `type`, `amount`, `balance_after`, `metadata` |
| `call_logs` | Call Detail Records (CDR) | `user_id`, `destination_number`, `duration_seconds`, `total_cost`, `status` |
| `referrals` | Referral tracking | `referrer_id`, `referred_id`, `status`, `referrer_credit` |

**Atomic Database Functions (PL/pgSQL):**
| Function | Purpose |
|----------|---------|
| `add_balance(user_id, amount)` | Atomically adds credit + creates transaction record |
| `deduct_balance(user_id, amount)` | Atomically deducts with insufficient balance check (row lock) |
| `get_user_balance(user_id)` | Quick balance lookup |
| `process_referral_bonus(referred_id)` | Credits $2 to both referrer and referred user |
| `generate_referral_code()` | Auto-generates unique `CG-XXXXXX` code on signup |
| `handle_new_user()` | Trigger: auto-creates profile row on auth signup |

### 4.2 Supabase Realtime

Used for live balance updates during active calls. Frontend subscribes to `profiles` table changes for the authenticated user, enabling real-time balance display without polling.

---

## 5. EXTERNAL INTEGRATIONS

| Service | Purpose | Integration Method |
|---------|---------|-------------------|
| **Twilio** | Voice calls (WebRTC → PSTN), caller ID, Voice webhooks | Voice SDK (frontend), TwiML App, Webhooks |
| **Stripe** | Payment processing (PCI DSS compliant) | Stripe.js (frontend), Stripe API (edge function), Webhooks |
| **Supabase Auth** | User authentication (email/password) | JWT tokens, `@supabase/supabase-js` client |
| **Firebase Cloud Messaging** | Push notifications for incoming calls (planned) | FCM SDK (Capacitor plugin) |
| **Apple Push Notification Service** | iOS push notifications (planned) | APNs via Capacitor |
| **Google Fonts** | DM Sans typeface (400, 500, 600, 700) | CSS `@import` / `<link>` |

---

## 6. DEPLOYMENT & INFRASTRUCTURE

| Layer | Service | Purpose |
|-------|---------|---------|
| **Frontend Hosting** | Vercel | Static site CDN, automatic deploys from Git |
| **Backend** | Supabase Cloud | Managed PostgreSQL, Auth, Edge Functions, Realtime |
| **Telephony** | Twilio Cloud | Voice SDK gateway, PSTN routing, caller ID |
| **Payments** | Stripe | PCI-compliant checkout, webhook events |
| **Domain** | `callglobe.app` | Primary application domain |
| **Native Build** | Capacitor | iOS (Xcode) + Android (Android Studio) app builds |

**CI/CD Pipeline:**
```
Git Push → Vercel Auto-Deploy (Frontend)
         → Preview URL (staging)
         → Production Promote

Supabase CLI → `supabase functions deploy` (Edge Functions)
             → `supabase db push` (Migrations)
```

**Infrastructure Costs (Startup Phase):**
| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Supabase | $0 | Free tier (50K MAU) |
| Vercel | $0 | Free tier (100GB bandwidth) |
| Twilio (minutes) | Variable | Depends on destination and routing |
| Twilio number / caller ID | Variable | Verified outbound identity requirement |
| Stripe | 2.9% + $0.30/txn | ~4–5% effective on $10–20 recharges |
| Domain | $12/year | `callglobe.app` |
| App Stores | $124/year | Google Play ($25 one-time) + Apple ($99/year) |

---

## 7. SECURITY CONSIDERATIONS

### Authentication & Authorization
- **Auth Method**: Supabase Auth (email/password), JWT tokens
- **Authorization**: Row Level Security (RLS) on all PostgreSQL tables
- **Edge Functions**: Authenticated via `Authorization: Bearer <JWT>` header
- **Admin Operations**: Service Role Key (server-side only, never exposed to client)

### Data Protection
- **Payments**: Stripe Checkout handles all card data (PCI DSS Level 1 compliant) — no card data touches our servers
- **Voice Encryption**: WebRTC calls encrypted via SRTP/DTLS (end-to-end)
- **Webhook Verification**: Stripe webhook signature verified via `stripe.webhooks.constructEvent()`
- **Secrets**: Stored as Supabase Edge Function secrets, never in client code

### Key Security Rules
- Twilio API secrets and Stripe secret keys stored as server-side secrets only
- Frontend only has access to `SUPABASE_ANON_KEY` (public, RLS-protected) and `STRIPE_PUBLISHABLE_KEY`
- Balance operations (`add_balance`, `deduct_balance`) are `SECURITY DEFINER` functions — run with elevated privileges, callable only through controlled paths
- CORS headers configured on edge functions

---

## 8. DEVELOPMENT & TESTING

### Local Setup

```bash
# 1. Clone and install
cd callglobe-complete/frontend
cp .env.example .env.local    # Fill in credentials
npm install
npm run dev                    # http://localhost:3000

# 2. Database
# Run backend/supabase/migrations/001_initial.sql in Supabase SQL Editor

# 3. Edge Functions
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy create-checkout
supabase functions deploy twilio-token
supabase functions deploy webhook-stripe
supabase functions deploy webhook-twilio
```

### Environment Variables

**Frontend (`.env.local`):**
| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `VITE_APP_URL` | App URL (http://localhost:3000 for dev) |

**Backend (Supabase Secrets):**
| Variable | Description |
|----------|-------------|
| `APP_BASE_URL` | Public frontend origin used for Stripe return URLs |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_API_KEY_SID` | Twilio API key SID |
| `TWILIO_API_KEY_SECRET` | Twilio API key secret |
| `TWILIO_AUTH_TOKEN` | Twilio auth token for webhook verification |
| `TWILIO_CALLER_ID` | Verified outbound caller ID |
| `TWILIO_TWIML_APP_SID` | Twilio TwiML App SID |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

### Testing Frameworks
- **Frontend**: No test framework configured yet (recommended: Vitest + React Testing Library)
- **E2E**: Not configured yet (recommended: Playwright)
- **Edge Functions**: Manual testing via `supabase functions serve` + curl

### Code Quality
- **Linting**: Not configured yet (recommended: ESLint + Prettier)
- **Type Safety**: JSX (no TypeScript on frontend yet); Edge Functions use TypeScript

---

## 9. FUTURE CONSIDERATIONS

### Known Technical Debt
- Frontend is pure JSX — no TypeScript, no type safety
- No automated test suite (unit, integration, or E2E)
- No linting or formatting toolchain configured
- `App-Prototype.jsx` is a 1700+ line monolith (prototype only, not used in production)
- CORS is set to `*` on edge functions (should be restricted to app domain)
- No rate limiting on edge functions
- Frontend bundle is still a single large chunk and should be split before scale-up

### Planned Features (from PRD)
| Feature | Priority | Target |
|---------|----------|--------|
| Push Notifications (FCM/APNs) | P0 | Q2 2026 |
| Contact Book | P1 | Q2 2026 |
| Subscription Plans (unlimited calling) | P1 | Month 5–6 |
| Multi-Language UI (Arabic, Hausa, Hindi, Tagalog, Bengali) | P1 | Month 4–5 |
| Mobile Top-Up (Reloadly/DingConnect) | P1 | Month 4–5 |
| Call Recording | P2 | TBD |
| Money Transfer / Remittance | P2 | Month 6+ (requires FINCEN MSB) |

### Planned Migrations
- Frontend JSX → TypeScript for type safety
- Consider migrating to Next.js for SSR benefits and Vercel optimization
- Add Vitest + Playwright test suites
- Tighten CORS to production domain only
- Add rate limiting and observability around edge functions

---

## 10. GLOSSARY

| Term | Definition |
|------|-----------|
| **CDR** | Call Detail Record — log of a single call with duration, cost, and status |
| **DID** | Direct Inward Dialing — a virtual phone number that can receive calls |
| **DTLS** | Datagram Transport Layer Security — encryption for WebRTC data |
| **Edge Function** | Serverless function running on Supabase (Deno runtime) |
| **PSTN** | Public Switched Telephone Network — the global phone system |
| **PWA** | Progressive Web App — web app with offline/install capabilities |
| **RLS** | Row Level Security — PostgreSQL policy that restricts row access per user |
| **SIP** | Session Initiation Protocol — signaling protocol for VoIP calls |
| **SRTP** | Secure Real-time Transport Protocol — encrypted voice/media transport |
| **WebRTC** | Web Real-Time Communication — browser-native voice/video protocol |
| **Caller ID** | The phone number displayed to the recipient when making an outbound call |
| **Corridor** | A calling route (e.g., Saudi Arabia → Nigeria) representing a diaspora market |
| **Twilio** | Cloud communications provider for Voice SDK, PSTN termination, and caller ID |
| **Capacitor** | Cross-platform native runtime by Ionic — wraps web apps for iOS/Android |

---

## 11. PROJECT IDENTIFICATION

| Field | Value |
|-------|-------|
| **Project Name** | CallGlobe |
| **Repository** | `callglobe-complete/` (local) |
| **Primary Contact** | Mousa |
| **Document ID** | CG-PRD-2026-001 |
| **Status** | Final (pre-launch) |
| **Target Launch** | Q2 2026 |
| **Platform** | Mobile PWA + Native (Capacitor) |
| **Backend** | Supabase + Twilio + Stripe |
| **Frontend Hosting** | Vercel |
| **Domain** | callglobe.app |
| **Last Updated** | March 2026 |
