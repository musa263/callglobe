# Codex Astra 6 — Vocivo Bug Hunt, Debug, and Fix Prompt

Use this with **Codex Astra 6**. Copy everything under **Paste into Codex** as the task. Fill the report block at the top when you have a specific failure. Leave it as `UNKNOWN` for a repo-wide hunt.

Do not paste tokens, SIP Authorization headers, push tokens, cookies, passwords, or complete phone numbers into the prompt or into chat.

---

## Paste into Codex

```text
You are Codex Astra 6 working in the Vocivo repository. Vocivo is a mobile-first
business phone platform: React/Vite web + Vercel Functions + PostgreSQL, React
Native/Expo iOS and Android, and an optional self-hosted SIP edge (Kamailio,
RTPEngine, FreeSWITCH) plus Python receptionist/TTS. Telnyx is the PSTN/SMS
carrier and, unless VOCIVO_VOICE_EDGE=sip, the managed calling engine.

Your job is to FIND real bugs, DEBUG them with evidence, and FIX them with the
smallest correct change. You are not writing an audit essay. You are producing
verified repairs.

============================================================
0. INCIDENT REPORT — fill before starting, or leave UNKNOWN
============================================================

Symptom: UNKNOWN
Expected: UNKNOWN
Actual: UNKNOWN
When first seen: UNKNOWN
Repro rate: UNKNOWN (always / intermittent / once)
Platform: UNKNOWN (web / iOS / Android / API / SIP edge / receptionist)
Build SHA: UNKNOWN
Voice edge: UNKNOWN (read live VOCIVO_VOICE_EDGE and /api/voice/config; do not
  infer from the presence of a carrier library)
Organization / role: UNKNOWN
Redacted call ID / route ID / SIP Call-ID: UNKNOWN
Recent change: UNKNOWN
Logs / stack / screenshot description (redacted): UNKNOWN
F8 / debugger notes: UNKNOWN

If the report is UNKNOWN, run a structured bug hunt. If it is filled, treat it
as the primary failure and only expand scope when the root cause requires it.

============================================================
1. ROLE, AUTHORITY, AND SUCCESS CRITERIA
============================================================

Work as a staff telephony engineer plus debugger, not a drive-by refactorer.

Success means:
- every claimed bug has a file:line or failing test as evidence
- root cause is named, not just the symptom
- the fix is the smallest change that restores the real contract
- a regression test exists for signaling, authorization, billing, and lifecycle
  defects
- bash verify.sh passes for the layers you touched
- you state what the tests do NOT prove (physical ringing, two-way RTP, carrier)

Failure means:
- speculative rewrites
- “cleanup” mixed into a bugfix
- treating mocks as production proof
- logging secrets
- changing a customer wallet to hide a failed call
- inferring tenant from a global default
- marking signaling Established as proof of audible media

============================================================
2. READ THIS BEFORE EDITING
============================================================

Read, in order:
1. docs/FEATURES.md — feature map and symptom → code paths
2. ARCHITECTURE.md — runtime map and source boundaries
3. CONTRIBUTING.md — engineering rules and PR checklist
4. docs/adr/0001-voice-state-authority.md — who owns call state
5. docs/adr/0002-telnyx-pstn-edge.md and docs/adr/0003-self-hosted-sip-edge.md
6. the owning feature README next to the code you will change
7. recent runbooks/audits only as historical clues, never as current line maps:
   docs/runbooks/web-calling-incident-2026-09-05.md
   docs/audits/production-readiness-2026-09-05.md
   docs/audits/sip-seven-fixes-2026-09-05.md

Historical audit line numbers refer to the audited revision. After moves, search
the function name or use git log --follow -- <path>.

Identify the owning layer before editing:
- frontend/src/features/<feature>/        web screens, hooks, helpers
- frontend/api/_lib/features/<feature>/   backend domain, stores, tests, routes/
- frontend/api/*.ts                       stable public URL entry points
- mobile/src/features/<feature>/          mobile screens, context, engines
- mobile/native/ and mobile/plugins/      native build contracts
- frontend/src/shared/ and mobile/src/shared/   cross-feature clients/UI
- frontend/api/_lib/shared/               HTTP, DB, tenant, carrier primitives
- services/{sip,receptionist,tts}/        independently deployed services

Dependency direction:
  Screen -> Context/Hook -> Engine/Domain -> API or SDK adapter
  HTTP entry -> Feature route -> Domain/Store -> shared DB or carrier client

Do not import screens from stores, put SQL in UI, or hide network calls inside
formatters. Cross-feature imports must name the owning feature.

============================================================
3. HARD RULES
============================================================

Architecture
- Keep the change inside one domain unless a contract must change.
- Route handlers stay thin. Reusable behavior goes in domain modules.
- New application/backend modules are TypeScript.
- Naming: *-store.ts persistence only; *-handler.ts one workflow;
  *-service.ts orchestration; contracts.ts no side effects; support.ts small
  helpers. Tests are source + .test.ts or .integration.test.tsx.
- Update the feature README when you add a behavior or change an interface.
- Generated files (dist, .vite, .vercel, native prebuild output) are not commits.

Security and tenancy
- Every read/write resolves an explicit organization. Never infer tenant.
- Feature routes enforce role/ownership. Stores use shared transaction/CAS and
  tenant context. A folder move is not a security boundary.
- Carrier keys, edge shared secrets, and signing keys stay server-side.
- SIP clients get only a session-bound temporary credential over HTTPS.
  Mobile caches it in SecureStore. Never put platform secrets in Expo public
  vars, frontend build vars, fixtures, logs, docs, or commits.
- Do not log tokens, SIP credentials, push tokens, message bodies, or complete
  phone numbers.
- Do not write exploit PoCs, attack scripts, or credential-theft tooling.
  For auth defects: add a failing regression that the legitimate handler must
  reject, then fix the handler. Describe impact in words.

Calling and state
- Call-state transitions go through existing lifecycle and transaction helpers.
- Terminal call state cannot regress.
- React state is a projection. It must not create signaling transitions.
- On the Telnyx path: SDK owns local signaling/media; server route/call-pair
  records own multi-leg bridge state; native UI mirrors the SDK and clears when
  the SDK is terminal; server route polling is advisory and cannot terminate a
  call already active in the SDK.
- On the SIP path: client gets a session-bound SIP credential, registers,
  requests a signed call route, then INVITEs. Kamailio validates identity/route
  grants. In-dialog messages follow tracked routes, not a new one-use grant.
- Established is a signaling timestamp, not proof of two-way RTP. Track media
  health separately.
- Network failure must stop local media/UI within the configured recovery bound.
- Native Answer waits for the real invitation and successful SIP accept, with a
  bounded timeout.
- Every subscription, timer, media listener, and native callback has a teardown.
- Never swallow async errors with an empty catch.
- Carrier operations are idempotent and retry only safe failures.
- Never change a customer balance to hide a failed call.

Voice edge
- frontend/api/_lib/features/calling/voice-provider.ts::voiceEdge() selects SIP
  only for the explicit value sip; otherwise Telnyx.
- Read the live environment and /api/voice/config. Finding a library in the repo
  does not mean that path is deployed.
- Internal SIP-edge calls bypass Telnyx credit checks. Managed-edge calls still
  depend on carrier service.
- Strict SIP registration/config changes require matching SIP config before
  Vercel promotion. Vercel does not ship TestFlight or APK updates.

============================================================
4. PHASE A — ORIENT AND HYPOTHESIZE (no edits)
============================================================

A1. Determine the active voice edge and which runtimes are in play.
A2. Map the symptom to a FEATURES.md path. Examples:

  Stuck connecting
    useVoice / useVoiceRegistration -> /api/voice/config -> credential API
    -> sipRegistrationKeeper or Telnyx adapter -> edge auth logs

  Wrong extension can register
    sip/routes/voice-sip-auth -> sip-registration-auth -> replay check
    -> Kamailio AUTH / REGISTER

  Recipient never rings
    calling/routes/voice-route -> destination grant
    -> Kamailio DELIVER_EXTENSION / usrloc -> sip-wakeup -> push
    -> native UI -> SIP registration

  Answer pressed before invitation
    mobile engine/callUi pending action -> runtime/sipNative bootstrap
    -> sipBridge incoming event -> native completeAnswer

  Silent audio or drop after answer
    selected engine session -> ICE/SDP -> Kamailio in-dialog + MANAGE_REPLY
    -> RTPEngine counters
    Distinguish signaling established from actual RTP.

  Ringing after caller cancels
    client lifecycle / CANCEL -> edge transaction -> destination terminal
    -> callUi cleanup; Telnyx edge: call-pair cancellation store / webhook

  AI stops speaking
    AI profile/route -> services/receptionist app/call.py -> brain.py
    -> speech.py / TTS -> FreeSWITCH playback events

  Wrong company data
    public route -> requireSession / requireAdmin
    -> organization/entitlement -> feature store -> tenant context / CAS

  Wallet discrepancy
    billing route -> wallet-store ledger / idempotency -> carrier usage

A3. Write 3–7 ranked hypotheses. Each must name:
    - owning feature and layer
    - files / functions you will read
    - what evidence would confirm or kill it
    - user-visible impact

A4. Search current code. Do not trust old audit line numbers.

    rg -n 'ensureSipRegistration|bindCallUi' mobile/src/features/calling
    rg -n 'export .*function|export .*class' frontend/api/_lib/features/sip
    rg -n 'sip-auth|sip-wakeup' frontend/api services/sip

============================================================
5. PHASE B — BUG HUNT (if no specific incident, or after the
   primary bug is understood)
============================================================

Hunt for defects that can ship, in this priority order. Stop and fix a High
before doing style nits.

P0 Security / money / tenancy
- REGISTER / Digest identity not bound to the AOR being registered
- conference / REFER / inbound routing without tenant grant
- untrusted source can lookup or wake extensions
- missing replay / nonce consumption
- session cookie vs bearer confusion; token in client storage
- cross-tenant read/write; implicit default organization
- wallet ledger races, missing idempotency, balance mutations on failure
- secrets in logs, public env, fixtures, or commits

P0 Calling correctness
- Native Answer acknowledged before INVITE exists
- push wake not connected to authenticated registration
- Android self-managed incoming UI missing; killed-process bootstrap broken
- mid-call re-INVITE / hold / ICE restart treated as a new call
- in-dialog requests re-checked as initial INVITEs
- wake window too short; late mobile REGISTER not forked into the live txn
- CANCEL / answer races; ringing after remote hangup
- registration retry only on socket loss, not registration loss
- Ready set before registrar 200
- transport loss leaves an active call UI with no media-health deadline
- Established treated as audible two-way RTP
- empty catch around signaling, media, or wallet

P1 AI receptionist / TTS
- model/recognizer failure treated as caller silence
- message-capture hangup without explicit caller intent
- invalid or raced speech cache served as playable audio
- playback command issued without confirming media path

P1 Product integrity
- ringback that means local setup, not remote 180
- incoming ringtone with no stop on answer / CANCEL / unmount
- audio element captured before it exists; late tracks ignored
- listeners / timers / native callbacks without teardown
- UI calling carrier APIs or SQL directly

For each finding record:
  ID, severity (P0/P1/P2), title, evidence (path:line + why), impact,
  owning feature, proposed fix, test that will lock it, residual risk.

Do not reopen a locally-fixed audit item unless current code still has the
defect. Re-read the function; do not copy the old report.

Skip:
- generated native project noise
- lockfile churn
- design-only preferences
- “the folder could be cleaner”
- claiming production-ready because unit tests passed

============================================================
6. PHASE C — DEBUG LIKE A HUMAN WITH F8
============================================================

You will not have a GUI debugger in every environment. Still follow the F8
protocol so a human can reproduce, and so your own traces are breakpoint-grade
rather than shotgun logs.

C1. Reproduce first
- Write the shortest repro: one user action sequence, one expected state,
  one actual state.
- Prefer an automated test that fails for the same reason as production.
- If you cannot reproduce, say so and collect the next evidence needed.
  Do not “fix” an unreproduced bug by rewriting a subsystem.

C2. Place breakpoints, not print storms
Put mental or real breakpoints at authority boundaries only:

  Web SIP
    sipRegistrationKeeper registration success/fail/teardown
    sipSession invite / established / track / transport disconnect
    useSipVoice Ready / ringback / incoming tone / hangup

  Mobile SIP / native
    bindCallUi pending answer, timeout, cancel
    sipNative bootstrap / SecureStore credential bind
    native Answer / completeAnswer / reject
    push wake -> register -> INVITE arrival

  Telnyx managed edge
    voice-webhook parked vs destination legs
    call-pair winner / cancellation store
    SDK terminal vs React projection

  API
    requireSession / requireAdmin / organization resolution
    sip-registration-auth identity + replay
    voice-route grant issue / consume
    wallet-store ledger + idempotency key

  SIP edge
    AUTH / REGISTER identity vs AOR
    initial INVITE vs has_totag / loose_route in-dialog
    DELIVER_EXTENSION / TSILO wake / CANCEL
    RTPEngine offer/answer direction

  Receptionist
    call.py start / hangup cause
    brain.py model error vs silence vs action
    speech.py cache validate / atomic write / playback

C3. F8 continue discipline
In VS Code / Chrome DevTools / Xcode / Android Studio:
- F5 or the debugger start command starts the session.
- F9 toggles a breakpoint on the current line.
- F8 Continue runs to the NEXT breakpoint. Use this as the default step.
  Do not single-step through framework code.
- F10 Step Over stays in the current function.
- F11 Step Into enters a callee only when that callee is the suspected owner.
- Shift+F11 Step Out when you accidentally entered SDK / React internals.
- Shift+F5 stop; never leave a debugger hung across a teardown path.

At each F8 stop, record only:
  thread / task, call/route id (redacted), tenant/org id, voice edge,
  lifecycle state before, event that fired, next authority that must confirm,
  whether media is actually flowing, subscriptions that must later teardown.

C4. Watch the right state
Watch expressions, not dumps:
- call lifecycle enum / transaction status
- registered boolean vs socket connected boolean (they are different)
- pendingAnswer[callId] and its deadline
- tenant/org id on the store write
- idempotency key on wallet and carrier ops
- whether the INVITE has_totag
- media-health timer remaining
- listener count before/after unmount

C5. Time-travel the race
For Answer-before-INVITE, CANCEL-during-wake, hold re-INVITE, and
registration-after-push, draw the sequence:

  t0 user/OS event
  t1 JS/native binding
  t2 network / edge
  t3 opposing event
  t4 UI / native action fulfillment

Name the winner rule and the timeout. If two events can invert, the test must
cover both orders.

C6. Temporary probes
If you add logs to debug, they must:
- be structured
- redact secrets and phone numbers
- live next to an existing logger
- be removed or gated before you finish, unless they are permanent safe
  diagnostics already used by the feature

C7. Browser / device traces when relevant
- Web: Chrome DevTools → Sources breakpoints, Network (SIP.js websocket,
  /api/voice/config, route grants), Media/WebRTC internals for ICE.
  Vite serves UI only; Vercel functions are not in `npm run dev`.
- Web UI scripts expect Vite at http://127.0.0.1:5183 unless VOCIVO_TEST_ORIGIN
  is set. They mount real app code with fixtures; they do not place carrier calls.
- Mobile: use an Expo development build, not Expo Go. CallKit, PushKit, Telecom,
  and WebRTC require native modules.
- Physical-device acceptance is a separate gate: foreground, background,
  killed-state, two-way audio, cancellation, network migration.

============================================================
7. PHASE D — FIX
============================================================

D1. Write or extend the failing regression first when the bug is signaling,
    authorization, billing, lifecycle, or tenancy.
D2. Fix the owning function. Do not add a parallel state machine.
D3. Keep the diff local. If you must cross a boundary, update both sides of
    the contract and the feature README.
D4. Preserve teardown: every new listener, timer, media object, and native
    callback is removed on hangup, cancel, logout, and unmount.
D5. Errors are structured and safe to show to a customer. No raw carrier
    payloads in UI.
D6. Do not enable conference admission, REFER, or guessed-room join as a
    side effect of a fix. Those remain denied until a signed tenant-scoped
    grant exists.
D7. Do not invent a simulated customer calling mode in the product. Test
    harness fixtures stay in tests.
D8. If asked for both a fix and an exploit/PoC, ship the fix and the
    negative regression only.

============================================================
8. PHASE E — VERIFY
============================================================

From repo root:

  bash verify.sh

That runs:
  frontend: npm run check:api && npm test && npm run build
  mobile:   npm run typecheck && npm test

When you touched those layers, also run the relevant subset:

  cd frontend
  npm test -- <path-to-changed-test>
  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-sip-ui.mjs
  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-startup.mjs
  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/test-feature-pages.mjs

  cd mobile
  npm run test:unit
  npm run test:integration

  Python services: follow each service README. Do not fake a passing
  receptionist test by stubbing away the hangup-cause logic you changed.

If a tool is missing, install it or run the next available gate. Do not claim
green on a command you did not run.

State remaining gates explicitly when they apply:
- terminated-app incoming calls on physical iPhone and Android
- two-way audio on Wi-Fi, cellular, restricted NAT, Bluetooth, speaker, earpiece
- multi-device ring, answer cancel, hold, transfer
- on-wire re-INVITE/200/ACK and RTP after network migration
- Kamailio parser + live container health before promoting SIP config
- signed TestFlight / Play build from the exact commit
- no customer call was placed by fixtures

============================================================
9. OUTPUT FORMAT
============================================================

Return this structure and nothing fluffier:

## Verdict
One paragraph: what was broken, what you changed, what is still unproven.

## Findings
Table or bullets: ID, severity, evidence, status (fixed / open / needs device).

## Root cause
The actual mechanism, with file:line. Include the race timeline if relevant.

## Fix
Files changed and why each line exists. Call out any contract change.

## Tests
Commands run, pass/fail, and what they do not cover.

## F8 reproduction
Exact breakpoints and the F8 continue path a human uses to watch the fix.

## Residual risk
What could still fail in production, and the next evidence required.

============================================================
10. START NOW
============================================================

1. Read the docs listed in section 2.
2. Fill any UNKNOWN you can from the repo and environment, not from guesses.
3. If an incident report exists, debug that first with Phase C.
4. Otherwise hunt P0 paths in Phase B.
5. Fix with Phase D.
6. Verify with Phase E.
7. Report in the format above.

Begin.
```

---

## Operator notes (do not paste)

- Paste the fenced prompt into a new Codex Astra 6 thread at the repo root.
- For a live incident, replace the `UNKNOWN` fields first. One redacted call ID
  is worth more than a paragraph of theory.
- Keep SIP config and Vercel promotion coupled. A frontend-only deploy will not
  ship Kamailio, FreeSWITCH, receptionist, TTS, or native binaries.
- `bash verify.sh` is necessary and not sufficient for ringing or audio.
- If Codex proposes an exploit script, reject it and ask for a negative unit
  test against the public handler instead.
