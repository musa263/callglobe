# Vocivo Architecture

This document is the entry point for engineers working on Vocivo. It describes the production system, source-code ownership, dependency direction, and voice-state rules. Update it whenever a runtime boundary changes.

## System Map

```text
iOS / Android (React Native) -+
                              +-- HTTPS -- Vercel API -- PostgreSQL
Web phone / Admin (React) ----+              |
        |                                    +-- Telnyx REST + signed webhooks
        +-------- Telnyx WebRTC SDK ----------+
                                             |
                                             +-- Python TTS service
```

Telnyx is the active signaling and media provider. Vocivo owns tenant identity, authorization, extensions, routing, call state, administration, messaging, billing, and product behavior. Internal extension calls are free to customer wallets, but their Telnyx media usage is a Vocivo platform expense.

## Repository Map

### `mobile/`

- `App.tsx`: composition and navigation only.
- `src/screens/`: user-facing screens; no direct carrier or database access.
- `src/context/`: React coordination for authentication, voice, business data, and messaging.
- `src/voice/`: voice contracts and deterministic, framework-light helpers.
- `src/lib/voipClient.ts`: the single native Telnyx SDK adapter.
- `src/lib/callLifecycle.ts`: authoritative lifecycle and termination locks.
- `src/lib/voiceRecovery.ts`: ICE and media recovery.
- `plugins/withTelnyxVoip.js`: Expo native configuration only.
- `tests/voip/`: mounted lifecycle and background-call integration tests.

### `frontend/`

- `src/pages/` and `src/admin/`: web-phone and administration UI.
- `src/hooks/`: React orchestration hooks.
- `src/voice/`: shared browser call identity and telemetry helpers.
- `api/`: thin Vercel route entry points.
- `api/_lib/routes/`: HTTP request validation and response mapping.
- `api/_lib/voice-webhook/`: Telnyx event contracts and focused event handlers.
- `api/_lib/*-store.ts`: persistence repositories.
- `api/_lib/object-store.ts`: shared PostgreSQL transaction and object primitives.

### `services/`

- `tts/`: isolated Python/FastAPI text-to-speech service.

### `docs/`

- Operational guides, readiness evidence, and architecture decision records.

## Dependency Rules

Dependencies flow inward. Lower layers must never import UI or HTTP route modules.

```text
UI -> Context/Hook -> Domain helper -> SDK/API adapter
HTTP route -> Domain service/handler -> Repository -> PostgreSQL/Telnyx
```

1. Screens render state and dispatch user intent. They do not call Telnyx directly.
2. React contexts coordinate subscriptions and component state. Pure parsing and state conversion live under `voice/` or `lib/`.
3. API routes authenticate, validate, invoke one domain operation, and map errors to HTTP responses.
4. Webhook handlers are idempotent and tenant-aware. New event flows belong in focused modules under `api/_lib/voice-webhook/`.
5. Stores own persistence and transactions. Business services must not issue ad hoc SQL.
6. Carrier secrets and SIP credentials never cross into browser or mobile bundles.

## Voice State Authority

The Telnyx SDK is authoritative for local signaling and media state. Server route state is authoritative for multi-leg orchestration. Native CallKit/Android Telecom mirrors these states and never invents a transition.

```text
IDLE -> CONNECTING -> RINGING -> ACTIVE -> HELD -> ACTIVE -> ENDED
                         \-> FAILED                  \-> FAILED
```

- Terminal states never regress.
- A call timer starts only after confirmed active media.
- Route polling is advisory and stops when the SDK reports an active call.
- Every listener and timer has an explicit teardown.
- Hangup, answer, bridge, and fork-winner operations are idempotent.
- The first answered fork is claimed atomically; all losing forks are terminated.

See [ADR 0001](docs/adr/0001-voice-state-authority.md) for the decision and failure-handling rules.

## Extension Call Flow

1. The authenticated client requests an internal route with a route ID and extension number.
2. The API confirms both extensions are active and owned by the same organization.
3. The API returns a short-lived, signed route authorization.
4. The Telnyx client creates a parked WebRTC leg containing the signed headers.
5. `voice-webhook.ts` classifies the event and delegates it to `parked-client-handler.ts`.
6. The handler validates the signed reservation, fans out to every active destination device, and stores the call pair.
7. The first destination to answer is atomically claimed and bridged; losing device legs are ended.
8. Hangup events terminate both legs and write one final route state.

## Tenant Security

- Every customer resource has an explicit organization owner.
- Session organization claims fail closed; there is no default customer tenant.
- Company administrators cannot access Vocivo platform credentials or another tenant's resources.
- PostgreSQL tenant context and row-level policies backstop application checks.
- Telnyx webhooks require Ed25519 signature verification and replay protection.
- Unresolved inbound events are quarantined without customer assignment.

## Quality Gates

Every pull request must pass:

```bash
./verify.sh
```

Passing source checks do not replace physical-device acceptance testing. TestFlight and Android release candidates must also pass killed-state ringing, two-way audio, Wi-Fi/cellular migration, multi-device answer cancellation, transfer, hold, and conference scenarios.
