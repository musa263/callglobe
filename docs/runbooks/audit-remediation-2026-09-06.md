# Sequential Audit Remediation

Date: 2026-09-06. Starting commit: `d9d36af`.
Scope: H01-H04 from the 29-finding local audit. Changes are local, not deployed.
No customer data, credentials, cloud settings, or native release was changed.

## Status

| Finding | Code section | Local confirmation | Release status |
| --- | --- | --- | --- |
| H01: shared superadmin tenant selection | Backend organizations/admin routes; web admin workspace | Scoped requests, two-tab AI saves, stale-form conflicts, foreign-tenant rejection | Implemented; production rollout not performed |
| H02: device credential collisions | SIP credential API/store; web device identity; mobile secure bootstrap | Four independent credentials survive REGISTER renewal; one-device revocation preserves the others; iOS/Android cache tests | Implemented; physical simultaneous ringing still required |
| H03: CallKit mute/hold command feedback | Mobile call UI, SIP bridge, native iOS manager | One transaction per app action; native commands do not echo; racing controls serialize; Swift typecheck | Implemented; physical controls/audio test still required |
| H04: hidden SIP/media sessions after transport failure | Mobile provider, SIP adapter, media recovery, secure cancellation outbox; backend cancel API | Mounted SIP provider removes calls and timer despite failed disposal signaling; late events cannot revive them; cancellation survives restart and stays session-scoped | Implemented for the audited SIP path; physical socket-loss/remote-termination test still required |

The remaining **25 findings are open**: H05-H11, M01-M15, and L01-L03. Passing
these tests is not a statement that the entire product is production-ready.

## H01: Tenant Workspace

- `frontend/api/_lib/features/organizations/request-organization.ts:12`:
  resolves explicit authorized tenant scope; company sessions cannot select a
  foreign organization. Superadmin write requests cannot depend on a shared
  global selection.
- `frontend/api/_lib/features/organizations/routes/admin-pbx.ts:10`:
  hashes the loaded tenant workspace; saves require that version and retain the
  database CAS. Another tenant's save does not invalidate unrelated drafts.
- `frontend/src/features/admin/workspace-api.js` and `AdminConsole.jsx`:
  capture tenant/generation per request, ignore stale responses, and select
  tenants through read-only navigation. Dedicated AI/number/trunk/key routes use
  the same explicit authorized scope.
- Tests: `request-organization.test.ts`, `admin-pbx.test.ts`,
  `workspace-api.test.js`, `scripts/test-admin-workspaces.mjs`.

Global Heritage remains a customer workspace, not the Vocivo platform owner.
The separate platform SaaS/wallet APIs were not converted into tenant APIs.

## H02: Multiple Devices

- `frontend/api/_lib/features/sip/sip-credential-store.ts:67`: rotate by
  device/session rather than `web` or `mobile`; revoke an exact generation.
- `frontend/api/_lib/features/sip/routes/voice-sip-credentials.ts`: derive owner
  from verified claims, return device/generation IDs, and authorize revocation.
- `frontend/src/features/calling/engine/sipDevice.js`: browser tab identities
  include a Web Locks lease to handle duplicated sessionStorage.
- `mobile/src/features/calling/runtime/sipNative.ts:52`: retain installation
  identity in SecureStore; include it on rotation and revoke the signed-in
  generation on cleanup.
- Tests: credential merge/revoke tests, actual REGISTER authorization with
  injected storage, browser identity tests, `SipBootstrap.integration.test.tsx`.

The existing six-credential cap and seven-day lifetime are unchanged. H05 access
revocation is separate and remains open. Old clients remain compatible with the
new API; the new mobile client needs the new API response first.

## H03: CallKit Controls

- `mobile/src/features/calling/engine/callUi.ts:177`: deduplicate state and
  distinguish native commands from mirrored acknowledgments.
- `mobile/src/features/calling/engine/sipBridge.ts`: serialize pending control
  changes and retain retryability on failure.
- `mobile/native/ios/VocivoSipCallManager.swift`: correlate action UUIDs and
  remove them on acknowledgment, timeout, call end, and provider reset.
- `mobile/native/ios/VocivoSip.swift`: expose native transaction failures through
  the JS promise instead of unconditional immediate success.
- Tests: actual bridge plus modeled native callback races in `sipBridge.test.ts`.
  Both changed Swift files pass simulator-SDK type checking with installed React
  headers. Two existing Apple API deprecation warnings remain.

M04, committing hold before the peer's final re-INVITE acceptance, remains open.
This fix removes feedback and serializes commands; it does not claim M04 solved.

## H04: Transport Cleanup and Cancellation

- `mobile/src/features/calling/VoiceContext.tsx:135` and `:425`: await remote
  cancellation outcomes during normal hangup, and distinguish local cleanup
  from pending remote work on fatal connection loss.
- `mobile/src/features/calling/engine/sipStackSipJs.ts:202`: close local media,
  detach the state listener, and bound public SIP.js disposal. No raw BYE packet
  generation or vendor source editing was added.
- `mobile/src/features/calling/engine/sipBridge.ts:233`: retire the tracked call
  before disposal can emit events. The facade closes native UI independently.
- `mobile/src/features/calling/media/voiceRecovery.ts`: cancel media polling
  and recovery waits when the call ends or subscriptions are removed.
- `mobile/src/features/calling/state/routeCancellation.ts`: durable, serialized
  session-scoped outbox; runtime storage is SecureStore. Failed delivery remains
  queued; storage failures propagate. No retry uses another login's credentials.
- `frontend/api/_lib/features/calling/routes/voice-cancel.ts` and
  `outbound-cancel.ts`: failed carrier legs yield a retryable response rather
  than `{ canceled: true }`; conference state is retained until termination.
- Tests: mounted `VoiceContext` with the real SIP bridge/client and fake native
  network boundary; outbox restart/race/isolation; abortable media waits;
  actual cancellation handler with injected provider/storage dependencies.

Limitations: the handset cannot transmit a remote BYE without connectivity. A
persisted cancellation still needs the original valid login and a running app
to retry. The legacy Telnyx fallback receives a bounded hangup plus native close;
the new forced SIP disposal behavior is not a claim of a carrier SDK rewrite.

## Verification and Rollout

Local results: 330 frontend/API tests, 112 mobile unit tests, and 15 mounted
mobile integration tests passed. Frontend API and mobile TypeScript checks,
the frontend production build, and `git diff --check` passed. Browser checks
passed for two simultaneous superadmin workspaces, 31 role/page cases, and the
existing web startup/registration/call-state scenarios. These browser APIs and
native/network boundaries were mocked; no live customer call was placed.
The existing 907 KB vendor-chunk warning remains L01, not a build failure.

Run from `frontend`: `npm run check:api`, `npm test`, `npm run build`.
Run from `mobile`: `npm run typecheck`, `npm test`.
Browser checks use intercepted local APIs, not customer accounts or real calls:
`scripts/test-admin-workspaces.mjs`, `scripts/test-feature-pages.mjs`, and the
existing browser startup/call-state regression script.

Backend/API must ship before the new mobile binary. Reload browser tabs after
web deployment; unscoped old superadmin writes intentionally fail closed.
The native CallKit changes require a new iOS build. Do not promote until physical
iOS/Android/web multi-device registration, mute/hold, audio, and socket-loss tests
pass. This work does not commit, push, deploy, or build TestFlight automatically.
