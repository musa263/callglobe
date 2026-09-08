# Vocivo second bug sweep — 2026-09-07

## Scope and version

This pass reviewed the working tree based on `3680d9e`, including pre-existing, uncommitted SIP/AI/native changes. Other work was changing this checkout during the audit. Findings describe the inspected code, not a verified deployment. No application code was edited by this sweep. A finite review cannot certify that every possible defect has been found.

Additional coverage: tenant password/session lifecycle, extension creation/update/deletion and directory persistence, account administration, API keys, profile/background uploads, enrollment/phone authentication, voicemail download/deletion, history aggregation, number purchasing and mobile sign-out. Existing role/ownership/CSRF checks were traced rather than assumed absent.

## Nine additional findings

### S01 — High: company-admin password changes leave old sessions authorized

Evidence: [saas-store.ts](../../frontend/api/_lib/features/organizations/saas-store.ts#L431), [auth-password.ts](../../frontend/api/_lib/features/auth/routes/auth-password.ts#L23), [auth.ts](../../frontend/api/_lib/features/auth/auth.ts#L196).

Changing a tenant administrator password updates the bcrypt hash and account timestamp, but does not revoke the account's existing JWTs. Session verification reloads active account data and roles without comparing a password/session generation or issuance time. The password route revokes sessions only for the platform owner. A previously issued tenant-admin token can therefore remain usable for its remaining 12-hour lifetime after a password change, including after a temporary-password reset is completed. This is a different defect from the owner's same-second revocation boundary in the first report.

Validation: traced token creation, password update and account-session verification. No live customer credential was changed. Fix: persist a session generation, include it in account JWTs, increment it on password change/reset, and reject stale generations before granting access. Test old tokens after user changes and administrator resets.

### S02 — Medium: an expired revocation cache is reused after a read failure

Evidence: [extension-session-store.ts](../../frontend/api/_lib/features/organizations/extension-session-store.ts#L15), [auth.ts](../../frontend/api/_lib/features/auth/auth.ts#L194).

After the normal five-second cache interval, a failed marker read falls back to any cached marker without an age bound. An instance holding a pre-revocation value may continue accepting a revoked extension token when that marker cannot be refreshed. This is conditional on the other session checks succeeding; it is not a claim that a complete database outage leaves every API operational. The SIP registration path's `fresh:true` behavior is stricter and does not share this fallback.

Fix: fail closed once cached authorization expires, or use a deliberately bounded policy with explicit risk acceptance. Test stale cache + remote revocation + marker read failure.

### S03 — High: a directory update can replace unreadable data with an empty directory

Evidence: [extension-store.ts](../../frontend/api/_lib/features/organizations/extension-store.ts#L65).

`updateExtensionDirectory` catches decryption errors and sets the current directory to `[]`, then executes the requested mutation and writes a new encrypted record. An unsupported/malformed stored version also leaves the initial empty array in place. A corrupt record or mismatched encryption key can thus become a destructive overwrite during an otherwise ordinary extension mutation. The shared directory covers multiple organizations. The transaction prevents races but does not prevent this loss-of-data fallback.

Validation: traced the exception and write branches; no production corruption was induced. Fix: distinguish an absent record from an unreadable one, abort writes on invalid data, and retain recovery evidence. Test ciphertext corruption and unknown versions without changing stored bytes.

### S04 — Medium: the sole administrator cannot make a role-omitting PATCH

Evidence: [admin-extensions.ts](../../frontend/api/_lib/features/organizations/routes/admin-extensions.ts#L88).

The PATCH branch treats an omitted `role` like a demotion when checking whether another active administrator remains. A legitimate partial name/email edit for the only linked administrator returns 409, although `updateExtension` would otherwise preserve the existing role. Clients that submit the full role avoid this bug.

Fix: evaluate the effective role (`requestedRole` or existing role) before deciding whether administrative access is being removed. Test a name-only PATCH for the sole administrator, alongside actual last-admin demotion denial.

### S05 — Medium: extension edits can partially succeed before login validation fails

Evidence: [admin-extensions.ts](../../frontend/api/_lib/features/organizations/routes/admin-extensions.ts#L100), [pbx.ts](../../frontend/api/_lib/features/organizations/pbx.ts#L308).

The carrier/directory update and extension-session revocation occur before the subsequent administrator-login save. The PATCH path has no compensating rollback if `saveTenantAdmin` rejects or storage fails. For example, when a role is omitted and another administrator exists, password validation is deferred to the login save; an invalid replacement password can produce an error after the extension has already changed. Email uniqueness failure can likewise leave directory and login identity inconsistent.

Fix: validate the complete intended state before side effects, then use a recoverable operation with compensation/reconciliation across carrier and database boundaries. Test validation failure and database failure after carrier acceptance.

### S06 — Medium: concurrent creates can exceed the subscription seat limit

Evidence: [admin-extensions.ts](../../frontend/api/_lib/features/organizations/routes/admin-extensions.ts#L51), [pbx.ts](../../frontend/api/_lib/features/organizations/pbx.ts#L155).

The seat count is read and checked before creation; the directory transaction checks duplicate extension numbers but does not enforce the seat limit. Two requests for different free numbers can both observe one remaining seat and both commit. The same preflight-count pattern exists for number orders; pending purchases are not represented in the assigned-number count.

Correction to an initial hypothesis: duplicate stored extension numbers are protected by the directory transaction. The confirmed issue here is capacity enforcement, not duplicate-number insertion.

Fix: atomically reserve capacity per tenant and account for pending purchases; release reservations on failure. Test simultaneous requests with one remaining seat/number allowance.

### S07 — Medium: an administrator's own extension suppresses other internal calls

Evidence: [call-history.ts](../../frontend/api/_lib/features/calling/call-history.ts#L70), [voice-history.ts](../../frontend/api/_lib/features/calling/routes/voice-history.ts#L22).

The route grants administrators `viewAll`, and the PSTN branch respects it. The internal-call branch still rejects calls unless the administrator personally participated whenever their account has an extension.

Reproduced against the real history mapper with one Alice-to-Bob fixture: `{viewAll:true}` returned one call; `{viewAll:true, extensionId:'admin', extension:'2000'}` returned zero. Fix: apply the same authorized view-all rule in the internal branch and retain tenant/non-admin denial tests.

### S08 — Medium: busy coworkers can push a user's own calls out of Recents

Evidence: [voice-history.ts](../../frontend/api/_lib/features/calling/routes/voice-history.ts#L16), [call-event-store.ts](../../frontend/api/_lib/features/calling/call-event-store.ts#L70).

Only the latest 250 tenant-wide events are fetched before the history mapper filters for the current extension. Once coworkers generate 250 newer events, a user's older but otherwise recent calls are not even candidates for their history. Truncation can also split the event set for a call and omit its answer/start event, affecting duration/status. No cursor is used to continue until enough authorized complete calls are assembled.

Fix: maintain call-level summaries scoped to participants or paginate events until sufficient complete authorized calls are found. Test a quiet extension in a busy tenant and calls straddling the event boundary.

### S09 — Medium: voicemail deletion can report success while retaining audio

Evidence: [voicemail-store.ts](../../frontend/api/_lib/features/calling/voicemail-store.ts#L113).

Audio deletion errors are suppressed, after which a deleted metadata event is written and the request succeeds. The recording can remain in private storage while disappearing from the UI, with no retry or failure surfaced. Conversely, metadata failure after successful audio deletion leaves a visible voicemail without audio.

Fix: record a durable deletion operation, retry audio removal and finalize the tombstone with an explicit recoverable state. Test failures at both storage steps. This is a retention/reliability defect, not a demonstrated public audio exposure.

## Workspace build check

`bash verify.sh` stopped at API typecheck:

`frontend/api/_lib/features/ai/ai-transfer-route.test.ts:19`: the uncommitted `releaseReplayKey` stub returns `Promise<void>` while its interface requires `Promise<boolean>` (TS2322).

The pending test was corrected by concurrent work to return `true` during this audit. The fresh full gate passed after that correction. This audit did not modify another task's pending changes.

## Reconciliation with the first report

- B03 (silent total synthesis failure) is repaired in current source: `_speak` raises `SpeechSynthesisError`, and the call flow handles it. Production rollout/real-audio acceptance was not verified here.
- B02 remains: completion timeout handling has improved, but `_send` still has an unbounded acknowledgment wait.
- B01 billing settlement, B04 CDR delivery durability, B05 SMS retry idempotency, B06 owner revocation boundary, B07 wallet totals and B08 persistent web notifications remain visible in the inspected source.
- Thus the first report must not be read as eight unchanged open defects. Seven remain open in this snapshot; nine additional findings above bring the reviewed backlog to sixteen, plus separate validation risks. This count is not an exhaustive guarantee.

## Additional coverage and limits

- Reviewed profile/background uploads: existing byte-size and MIME allowlists are present. Byte signatures are not checked, and replaced public image objects are not cleaned up; these are hardening/storage-lifecycle follow-ups, not proven executable upload flaws.
- Carrier voicemail download uses an unbounded `fetch`/`arrayBuffer`. The URL is documented as signature-verified carrier data, so this is a timeout/memory-resilience follow-up, not a demonstrated arbitrary-user SSRF.
- API-key hashes/scopes, cookie CSRF checks, phone verification gating, number release ownership checks and mobile multi-step logout cleanup are present; their existence is not an end-to-end certification.
- Existing targeted auth/password, SaaS and history tests: **18 passed**. The extra history probe reproduced S07 despite those tests passing.
- Full gate: final rerun passed — API typecheck, 401 frontend/API tests, production web build, mobile typecheck, 134 mobile unit tests and 46 integration tests in 8 suites. These do not cover the newly identified failure paths or establish production/native-media acceptance.
- No deployment, customer calls, messages, credential resets, destructive data probes or physical-device tests were performed.
- First-pass dependency/TURN/native-media/TTS-environment limitations still apply. No new advisory scan or production load test was performed in this pass.

Recommended order: close tenant-session revocation and destructive-directory fallback; complete billing/AI acknowledgment fixes from pass one; then repair account consistency, capacity enforcement, history and deletion workflows. Re-run the full gate on a stable commit and perform device/media acceptance separately.
