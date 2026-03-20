# CallGlobe — Complete Project Package

## What's in this package

```
callglobe-complete/
│
├── docs/                              ← Documentation
│   ├── CallGlobe-PRD.docx            ← Full Product Requirements Document (Word)
│   ├── callglobe-launch-checklist.docx ← Step-by-step launch checklist (Word)
│   └── SETUP_GUIDE.md                ← Technical setup guide (Markdown)
│
├── design/                            ← UI/UX Design
│   └── UI-Design-Spec.md             ← Colors, typography, components, screen flows
│
├── frontend/                          ← Frontend Application
│   ├── src/
│   │   ├── App-Prototype.jsx          ← Complete interactive prototype (1700+ lines)
│   │   ├── App.jsx                    ← Production app with Supabase/Telnyx integration
│   │   ├── main.jsx                   ← Entry point
│   │   ├── components/
│   │   │   ├── CountryPicker.jsx      ← Country selection modal
│   │   │   ├── Header.jsx            ← App header with user avatar
│   │   │   └── TabBar.jsx            ← Bottom navigation
│   │   ├── hooks/
│   │   │   ├── useAuth.js            ← Authentication state management
│   │   │   └── useTelnyx.js          ← WebRTC calling engine hook
│   │   ├── lib/
│   │   │   ├── supabase.js           ← Supabase client + all API functions
│   │   │   └── telnyx.js             ← Telnyx WebRTC wrapper
│   │   ├── pages/
│   │   │   ├── ActiveCallScreen.jsx   ← In-call UI with timer/controls
│   │   │   ├── AuthScreen.jsx        ← Login/Signup screen
│   │   │   ├── DialerScreen.jsx      ← Main dialer with keypad
│   │   │   ├── HistoryScreen.jsx     ← Call history log
│   │   │   ├── RatesScreen.jsx       ← Country rate browser
│   │   │   ├── RechargeScreen.jsx    ← Balance top-up with Stripe
│   │   │   └── SplashScreen.jsx      ← Animated splash
│   │   └── styles/
│   │       └── global.css            ← Global styles + animations
│   ├── public/
│   │   └── manifest.json             ← PWA manifest
│   ├── package.json                   ← Dependencies
│   ├── vite.config.js                ← Build config
│   ├── index.html                    ← HTML entry
│   └── .env.example                  ← Environment variables template
│
├── backend/                           ← Backend (Supabase)
│   └── supabase/
│       ├── migrations/
│       │   └── 001_initial.sql        ← Full database schema (profiles, rates,
│       │                                 packages, transactions, call_logs,
│       │                                 referrals, balance functions)
│       └── functions/
│           ├── create-checkout/
│           │   └── index.ts           ← Stripe checkout session creator
│           ├── webhook-stripe/
│           │   └── index.ts           ← Payment success → add balance
│           └── webhook-telnyx/
│               └── index.ts           ← Call events → log CDR, deduct balance
│
└── README.md                          ← This file
```

## Quick Start

1. Sign up at telnyx.com, create Credential Connection, buy a phone number
2. Create Supabase project, run `001_initial.sql` in SQL Editor
3. Deploy edge functions with `supabase functions deploy`
4. Set environment secrets (Telnyx API key, Stripe keys)
5. Configure `.env.local` in frontend with all credentials
6. `npm install && npm run dev`
7. Make your first call!

See `docs/callglobe-launch-checklist.docx` for the detailed step-by-step guide.
