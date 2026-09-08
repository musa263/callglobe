---
name: vocivo-engineering
description: Implement, debug, and review Vocivo features across web, native mobile, serverless APIs, PostgreSQL, SIP infrastructure, and real-time voice AI. Apply to engineering work in the Vocivo repository.
---

# Vocivo engineering

## Required working method

Read root `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/FEATURES.md`, and the owning
feature README. Paths here are relative to the repository root unless stated
otherwise. Trace the affected flow across client, control plane, signaling,
media, persistence, and AI before editing the relevant boundaries. Distinguish
configured SIP and Telnyx managed paths; finding a library does not establish
the active engine. Consult version-matched primary documentation when behavior
is uncertain. Do not substitute assumptions for native-device or carrier evidence.

Treat the competencies below as required engineering capabilities, not as a claim
that an agent has been trained or certified. Apply the relevant requirements to
each task; do not expand a narrow change into a platform rewrite or full audit.

## 1. Full-stack app engineering

- **Web:** React 18, Vite 5, TypeScript, hook lifecycles, asynchronous state,
  accessible responsive UI, and browser media permissions. Follow the installed
  versions and lockfile. Avoid stale callbacks and duplicate subscriptions.
- **Mobile:** React Native 0.81 and Expo SDK 54; this repository's mobile manifest
  uses React 19.1, independently of web React 18. Use development builds for
  native telephony. Keep reproducible native changes in `mobile/native/` and
  `mobile/plugins/` using Expo config plugins; validate regeneration when plugins
  change instead of relying on edits to generated native projects.
- **Native telephony:** Swift/Objective-C on iOS and Kotlin on Android, including
  CallKit, PushKit, Telecom/ConnectionService, audio-session ownership, background
  execution, and bridge initialization. Reconcile OS events with the existing JS
  lifecycle even when JS starts late. Handle answer/cancel races, duplicate pushes,
  remote hangup, permissions, audio focus, Bluetooth, and bounded action timeouts.
  Verify foreground, background, and killed-state behavior on physical devices.
- **Control plane:** TypeScript Vercel Functions with thin public route adapters
  and domain modules. Understand request timeouts, cold starts, connection pooling,
  and retry semantics. Keep persistent media/ESL sessions in their services.
  Use `jose` with explicit signature, issuer/audience, and expiry validation as
  appropriate to the token contract; use `bcryptjs` for password verification.
  Never treat decoded claims as verified claims or expose shared carrier secrets.
- **PostgreSQL:** Explicit tenant ownership and role checks on every operation;
  understand row-level security and pooled-connection tenant context. Verify whether
  RLS is actually enabled and whether the runtime role bypasses it. Use scoped
  transactions, row locks, atomic conditional updates, or established CAS helpers
  for concurrent wallet changes. Avoid read-then-write balance races. Preserve
  ledger consistency, currency precision, and idempotency across repeated events.
- **Feature architecture:** Use `frontend/src/features/`, `mobile/src/features/`,
  and `frontend/api/_lib/features/`. Keep SQL and carrier access out of screens;
  keep public API URLs stable. Shared modules hold cross-feature primitives.
  Update the owning feature's contracts and README when behavior changes.

## 2. VoIP and telecom infrastructure

- **Kamailio 5.8+:** Understand registrar/location state, transactions, dialog
  routing, retransmissions, CANCEL/ACK/BYE, and bounded late registration after
  push. Keep initial request authorization distinct from in-dialog routing.
  Treat custom cryptographic headers as untrusted input: enforce the implemented
  signature, expiry, identity/destination binding, and replay contract. Validate
  short-lived HTTPS-issued Digest credentials, including nonce and realm behavior;
  custom route authorization does not replace Digest authentication.
- **FreeSWITCH:** Build dynamic dialplans through `mod_xml_curl`; authenticate the
  control-plane boundary, escape XML, constrain destinations to authorized routes,
  and provide bounded failure behavior. Understand channel UUIDs, leg ownership,
  bridge/transfer lifecycle, hangup events, and restricted ESL access.
- **Media:** Configure rtpengine for WebRTC DTLS-SRTP/ICE to carrier RTP interop;
  understand SDP negotiation, codecs, sample rates, RTCP, and media anchoring.
  Cover offer/answer updates and teardown. Configure coturn STUN/TURN fallback,
  expiring credentials, allocations, and network/firewall requirements without
  creating an open relay. Diagnose signaling and two-way audio separately.
- **Carrier interconnect:** Secure Telnyx IP-authenticated termination trunks,
  outbound destination policy, number normalization, caller identity, and routing.
  Verify webhook authenticity before processing and handle duplicate, delayed,
  and reordered events with idempotent transitions. Correlate carrier legs without
  allowing terminal call states or charges to regress or duplicate.
- **Validation:** Read `services/sip/README.md` and `docs/SIP_TRUNKING.md`. Parse
  changes with the configured Kamailio version and exercise relevant signaling
  tests. A successful SIP response or UI timer does not prove working RTP.

## 3. Real-time AI and audio pipelines

- **Python concurrency:** Use `asyncio` and FreeSWITCH ESL with per-call ownership,
  bounded queues, timeouts, cancellation, and cleanup on disconnect. Keep blocking
  STT/TTS inference off the event loop. Correlate events and command completions
  to the correct channel; avoid shared mutable conversation state across calls.
- **Local STT/TTS:** Configure faster-whisper, including CPU `int8` inference, and
  optimized Kokoro TTS for constrained CPU hosts. Measure concurrency, memory,
  thread counts, model load time, and first-audio latency on representative
  hardware. Validate sample rate/channel conversion; do not assume real-time
  capacity from a single successful transcription. Bound synthesis caches and
  keep private tenant content isolated.
- **Claude integration:** Manage Anthropic API context/token budgets, streaming,
  timeout/retry behavior, and tenant-specific prompts. Bound retained history and
  preserve necessary call context when summarizing. Treat caller speech and model
  output as untrusted: validate transfers and actions against server-side tenant
  policy. Never permit the model to choose arbitrary tool destinations or access.
- **Barge-in:** Use caller-side VAD with measured thresholds/debounce so playback
  echo does not trigger interruption. On accepted interruption, stop current
  playback and cancel or invalidate pending LLM/TTS work, discard stale audio,
  and return control to listening. Ensure a delayed result cannot resume an old
  turn. Test silence, short utterances, noise, overlapping speech, and hangup races.
- **Failure and privacy:** Follow `services/receptionist/README.md` and
  `services/tts/README.md` for current behavior. Preserve tenant routing and
  fallback policy when STT, LLM, or TTS fails. Respect configured transcript and
  recording retention; establish what leaves the host before making privacy claims.

## 4. Additional production competencies

- **Security and abuse prevention:** Authentication versus authorization, tenant
  isolation, least privilege, secret rotation, replay prevention, rate limits,
  toll-fraud controls, destination restrictions, and dependency risk. Redact
  credentials, push tokens, message content, and full phone numbers from logs.
- **Distributed systems:** State machines, idempotency keys, retry budgets,
  backoff, optimistic concurrency, reconciliation, and partial failure. Preserve
  existing lifecycle/transaction helpers; every timer, subscription, native
  callback, and media resource needs teardown.
- **Verification:** Add regression coverage for signaling, authorization, and
  billing fixes as required by `CONTRIBUTING.md`. Test tenant denial, concurrent
  writes, repeated/out-of-order events, and lifecycle races where affected.
  Run `bash verify.sh` for code changes and relevant browser, Python, SIP, or native
  checks. Documentation-only edits need link/content validation, not app builds.
  Distinguish mocked tests from real-device, carrier, and capacity acceptance.
- **Observability:** Correlate API request, call, SIP dialog, carrier leg, and AI
  turn identifiers safely. Measure registration/call setup failure, media health,
  dropped calls, STT/LLM/TTS latency, queue depth, and billing reconciliation as
  relevant. Use evidence to separate UI, signaling, media, and provider failures.
- **Delivery and operations:** Reproducible builds, container/config validation,
  backward-compatible migrations, health/readiness checks, rollback, and backup
  restoration. Coordinate SIP credential/routing contract changes with control
  plane rollout order. Keep mobile release gates separate from Vercel deployment.
- **Product quality:** Accessibility, international phone formatting, localization,
  permission-denial recovery, offline/reconnect states, and actionable safe errors.
  Understand recording consent, emergency-calling behavior, and data-residency
  requirements when relevant; verify applicable requirements rather than inventing
  compliance guarantees.

## Completion and handoff

State the changed behavior and affected contracts, report executed checks and
results, and name unverified acceptance gates. A missing device, service, or
credential is a limitation to report, not evidence of a passing integration.
When another agent is assigned authorized work, pass this skill and root
`AGENTS.md` with its bounded task and require the same evidence in its handoff.
