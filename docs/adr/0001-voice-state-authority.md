# ADR 0001: Voice State Authority

- Status: Accepted
- Date: 2026-08-30

## Context

Vocivo observes one call through four asynchronous systems: the Telnyx SDK, Telnyx Call Control webhooks, native CallKit/Android Telecom, and React UI state. Treating every source as equally authoritative creates ghost ringing, stale timers, duplicate hangups, and answered-call races.

## Decision

1. The Telnyx SDK owns local signaling and media state.
2. The server route and call-pair records own multi-leg bridge state.
3. Native call UI mirrors the SDK and must be cleared when the SDK becomes terminal.
4. React state is a projection and must not create signaling transitions.
5. Server route polling is advisory. It may fail a pre-active call, but it cannot terminate a call already active in the SDK.
6. Call completion, fork selection, bridge, and termination are idempotent transactions.

## Consequences

- All call-state changes have one documented authority.
- Event ordering differences across Vercel instances cannot regress terminal state.
- Every new call feature must state which authority initiates and confirms its transitions.
- Physical-device acceptance remains required because native background behavior cannot be proven by unit tests alone.
