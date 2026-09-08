# Contributing to Vocivo

## Start Here

1. Read `docs/FEATURES.md`, the owning feature's README, and `ARCHITECTURE.md`.
2. Identify the owning layer before editing code.
   For an agent-led bug hunt, F8 debug, and fix pass, start from
   `docs/prompts/codex-astra-6-debug-and-fix.md`.
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

Place code under `src/features/<feature>/` in each client and
`frontend/api/_lib/features/<feature>/` in the backend. Colocate domain tests.
Feature `routes/` contain HTTP handlers; public files in `frontend/api/` retain
the deployed URL contract. Keep `App` and `AdminConsole` as composition roots.
Shared folders are for genuinely cross-feature primitives, not miscellaneous code.
Add the flow, key function responsibilities, failure modes, and test commands to
the feature README whenever introducing a behavior or changing an interface.

- `*-store.ts`: persistence only.
- `*-handler.ts`: one event or request workflow.
- `*-service.ts`: reusable domain orchestration.
- `contracts.ts`: transport and domain interfaces with no side effects.
- `support.ts`: small shared utilities for one bounded domain.
- Tests use the source filename plus `.test.ts` or `.integration.test.tsx`.

## Local Validation

`frontend/tsconfig.json` is the canonical API compiler configuration. Keep its
target, module and strict settings explicit: Vercel applies defaults before
resolving inherited configuration. `tsconfig.api.json` extends it for local checks.

```bash
bash verify.sh
cd frontend
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-sip-ui.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-startup.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/test-feature-pages.mjs
```

The browser scripts expect Vite at `http://127.0.0.1:5183` unless
`VOCIVO_TEST_ORIGIN` is set. Their HTTP/SIP fixtures mount the real application
code, but do not exercise the production carrier or place calls. Run Python
service tests using the dependency instructions in each service README.
Physical-device acceptance requires separate foreground/background, killed-state,
two-way audio, cancellation, and network migration checks.

## Pull Request Checklist

- Tenant ownership is explicit on every read and write.
- Carrier operations are idempotent and retry only safe failures.
- Terminal call state cannot regress.
- Errors are structured and safe for customer display.
- New listeners and timers are removed during teardown.
- Backend tests, API typecheck, web build, mobile typecheck, and mobile tests pass.
- Architecture documentation is updated when a boundary or runtime dependency changes.
