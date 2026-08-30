# Contributing to Vocivo

## Start Here

1. Read `ARCHITECTURE.md` and the relevant decision record under `docs/adr/`.
2. Identify the owning layer before editing code.
3. Keep changes within one domain unless a contract intentionally changes.
4. Add a regression test before or with every signaling, authorization, or billing fix.

## Engineering Rules

- Prefer TypeScript for new application and backend modules.
- Keep route handlers thin and move reusable behavior into domain modules.
- Do not add carrier calls, SQL, or storage access to React screens.
- Do not log tokens, SIP credentials, push tokens, message bodies, or complete phone numbers.
- Never infer a tenant from a global default.
- Never swallow asynchronous errors with an empty catch.
- Every event subscription, timer, media listener, and native callback must have a teardown.
- Call-state transitions must go through the existing lifecycle and transaction helpers.
- Generated files (`dist`, `.vite`, `.vercel`, native prebuild output) do not belong in commits.

## Naming

- `*-store.ts`: persistence only.
- `*-handler.ts`: one event or request workflow.
- `*-service.ts`: reusable domain orchestration.
- `contracts.ts`: transport and domain interfaces with no side effects.
- `support.ts`: small shared utilities for one bounded domain.
- Tests use the source filename plus `.test.ts` or `.integration.test.tsx`.

## Pull Request Checklist

- Tenant ownership is explicit on every read and write.
- Carrier operations are idempotent and retry only safe failures.
- Terminal call state cannot regress.
- Errors are structured and safe for customer display.
- New listeners and timers are removed during teardown.
- Backend tests, API typecheck, web build, mobile typecheck, and mobile tests pass.
- Architecture documentation is updated when a boundary or runtime dependency changes.
