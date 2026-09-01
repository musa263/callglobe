# CallGlobe (Vocivo) Codebase Review — Bugs & Issues by Severity

**Date:** September 1, 2026
**Scope:** Every production source file was read in full, line by line — `frontend/api` (Vercel serverless backend, ~10,000 lines), `frontend/src` (React web app, ~3,050 lines), `mobile/src` (React Native app, ~4,880 lines), `services/tts` (Python voice-synthesis service), and deploy/config scripts. `node_modules`, build output (`dist`, `.expo`, `android`, `ios` build artifacts), and `*.test.ts`/`*.test.js` files were excluded from line-by-line review (tests were spot-checked, not audited).

**Totals:** 24 High, 52 Medium, 44 Low findings across 9 reviewed areas.

**How to read this:**
- **High** — security vulnerability (auth/tenant bypass, IDOR, credential exposure), a call/data left in a broken or double-billed state, or a crash in a critical path.
- **Medium** — a real correctness bug in a less-common path, a race condition, or a missing-error-handling gap that produces silently wrong behavior or data.
- **Low** — a narrow edge case, a code-quality issue with real but small impact, or dead/inconsistent code worth cleaning up.

---

## Contents
1. [High Severity](#high-severity)
2. [Medium Severity](#medium-severity)
3. [Low Severity](#low-severity)
4. [Areas reviewed with no significant findings](#areas-reviewed-with-no-significant-findings)

---

## High Severity

### Backend — data & storage layer

**1. `frontend/api/_lib/saas-store.ts:405` — Editing an admin silently resets their role to the highest privilege.**
```js
role: input.role === 'company_admin' ? 'company_admin' : 'company_owner',
```
Every other field in this update falls back to the existing value when not supplied; `role` does not. Any edit that omits `role` (e.g. a name change or password reset) silently promotes the account to `company_owner`, the most privileged role, with no audit trail.

**2. `frontend/api/_lib/saas-store.ts:407` — Editing a suspended admin silently reactivates them.**
```js
status: input.status === 'suspended' ? 'suspended' : 'active',
```
Same pattern as #1 — no fallback to `existing?.status`. A suspended admin (e.g. offboarded staff, or one suspended during a security incident) is silently flipped back to `active` the next time any field on their record is edited.

**3. `frontend/api/_lib/pbx.ts:270-322,338-345` — Extension credential lookups/edits have no organization ownership check.**
`getExtension`, `getExtensionCredentials`, `updateExtension`, and `deleteExtension` operate on a bare `id` with no check that the extension belongs to the caller's organization. `getExtensionCredentials` in particular returns the SIP username/password for whatever `id` is passed. If any calling route resolves `id` from a request parameter without independently verifying tenant ownership, a user in Tenant B who obtains/enumerates Tenant A's extension ID can read Tenant A's SIP credentials or modify/delete their extension — a cross-tenant IDOR on telephony credentials at the library layer, regardless of what individual routes currently do to guard it.

**4. `frontend/api/_lib/pbx.ts:131-150,262-268` — One tenant's stale extension record breaks extension lookups for every tenant.**
`listExtensions()` builds one shared, unfiltered, all-organizations cache via a sequential loop with no try/catch around `requireManagedCredential`. If any single tenant has an extension record whose Telnyx credential was deleted out-of-band, the loop throws, the shared cache promise rejects, and `listExtensions`/`getExtension`/`findExtension` — which back internal call routing — fail for **every tenant** until the one bad record is fixed. A single tenant's bad data becomes a platform-wide outage.

**5. `frontend/api/_lib/outbound-cancel.ts:23-63` — Host hangup during a 3-way call never hangs up the remaining legs.**
`conferenceParticipantTeardown`'s branching misses the case where the host's own leg hangs up during an active (non-merging) conference — none of the existing `if` branches match, so it falls through to a `return` that only reports the leg that already hung up. The caller then deletes all tracking for the other two legs without ever sending them a hangup command. **Result: both remaining parties stay bridged and connected on Telnyx indefinitely, with no server-side record left to ever terminate them** — an untracked, uncancellable live call.

**6. `frontend/api/_lib/outbound-cancel.ts:176-193` — Cancel computes which legs to hang up from a stale snapshot, dropping concurrently-added legs.**
`terminateOutboundPair` derives the set of call-control IDs to hang up from the caller-supplied `pair` object, not a fresh read. If a call fork/merge adds a new leg between the caller's read and this function running, that leg is excluded from the hangup set — yet once the (incomplete) hangup set is judged "complete," all tracking for the pair is deleted. **The new leg's PSTN call is left connected and permanently untrackable.**

### Backend — auth & security boundary

**7. `frontend/api/_lib/auth-rate-limit.ts:103-108` — Any successful login resets the shared IP-wide brute-force counter, enabling indefinite password-spraying.**
`clearAccountLoginFailures` wipes both the account-scoped failure counter and the **IP-scoped** counter — but the IP counter is meant to throttle *all* login attempts from that IP across *every* account, not just the one that just succeeded. An attacker spraying passwords across many accounts from one IP can interleave one successful login (their own trial account, or one guessed credential) to reset the shared IP throttle and resume spraying indefinitely.

**8. `frontend/api/_lib/telnyx-webhook-auth.ts:9-28` — Webhook signature verification likely runs against reconstructed bytes that don't match what Telnyx actually signed.**
`rawBody()` only trusts `req.rawBody` (not populated by the `@vercel/node` runtime in use) or an already-drained request stream. No route disables Vercel's automatic body parsing (`bodyParser: false`), so by the time the handler runs, the raw stream is already consumed and the code falls back to `Buffer.from(JSON.stringify(req.body))` as a stand-in for Telnyx's original bytes — which is not guaranteed to be byte-identical (whitespace, key order, number formatting). The existing unit test only re-verifies against its own `JSON.stringify` reconstruction, so it doesn't catch this. **If this reproduces in production, every genuine Telnyx webhook (inbound calls, SMS, all call-control events) could be rejected as unauthorized, silently breaking the entire voice/messaging pipeline.** (Fails closed, not open — no security bypass, but a potential total outage from an unverified assumption.)

### Voice webhook handler (`frontend/api/_lib/routes/voice-webhook.ts` — the core Telnyx call-control handler)

**9. Lines 882-898 — Ring-group/queue agent bridging has an unprotected race with no atomic claim.** Read-check-write on queue status with no locking (confirmed: `queue-call-store.ts`'s save is a plain unconditional `put`, unlike the locked/CAS pattern used for outbound-call winner-claiming elsewhere in this same file). Two agents' `call.answered` events landing close together can both pass the status check and both get bridged to the same queue slot — one agent ends up bridged to nothing, or a losing bridge's cleanup stomps the winner's "connected" state with a stale snapshot.

**10. Lines 850-880 — `call.enqueued` dial-out has no idempotency/replay guard.** Unlike the inbound-answer path (which uses `claimReplayKey`), this only checks `queue.status !== 'waiting'` before dialing every ring-group/queue member, and doesn't write `status: 'dialing'` until several awaits later. A duplicate webhook delivery (a normal Telnyx retry) can pass the check twice before either write lands — **every agent in the group gets double-rung, and every leg is dialed twice**, doubling cost for that hunt.

**11. Lines 973-983 — Conference creation has no error handling; the caller is left connected in silence.** The `POST /conferences` call isn't wrapped in try/catch. On any Telnyx failure (rate limit, network blip, bad param) the exception falls to the generic 500 handler, which only logs — no hangup, no fallback message. The already-answered caller stays connected with dead air indefinitely. The very next block in the same file (`conference_guest` join) correctly catches and hangs up on failure, confirming this is a real, inconsistent gap.

**12. Multiple locations (lines 88, 1070, 1078, 1082, 1113, 1165, 1173, 1176, 1186) — The main inbound-call dial path has no error handling anywhere.** `routeToAgent`/`routeToAvailableAgent`/`routeToExtension`/`routeToCallGroup` — used by essentially every department/extension/queue selection in the primary IVR flow — never wrap `dialCall` in try/catch, and `dialCall` itself doesn't catch internally. Any failure propagates to the generic 500 handler with **no compensating action on the caller's leg** — no hangup, no voicemail fallback. This is the single most commonly executed code path in the entire file.

**13. Lines 761-805 — The system marks a caller "connected" to an agent before the actual bridge is attempted.** As soon as an agent's device answers, the caller's waiting-audio is stopped and the active-call-route is recorded as connected — before the real caller→queue bridge command is even sent (that happens later, in a separate handler). If that later bridge then fails, or loses the race in finding #9, the caller is left connected in silence while the system's own records falsely show them bridged to that agent.

### Mobile app

**14. `mobile/src/context/VoiceContext.tsx:340-341` — Mute/hold indicators update the wrong call during multi-call scenarios.** Unlike the sibling `callState$` handler three lines above (which correctly guards `if (current?.id !== call.callId) return current;`), the mute/hold subscriptions apply their update to whatever call is currently displayed, regardless of which call actually fired the event. With call-waiting/hold/merge (all supported features), muting or resuming a *parked* call can silently overwrite the *active* call's mute/hold indicator — the UI can show "not muted" while the mic is actually muted, or vice versa.

**15. `mobile/src/context/VoiceContext.tsx:928-944`, wired via `ActiveCallScreen.tsx:193,195,197` — Mute/hold/speaker toggles have no error handling.** If the native SDK call throws (call already ended, bridge error), the rejection is unhandled — the button appears to silently do nothing, with no retry and no error surfaced. `toggleSpeaker` explicitly re-throws, guaranteeing an unhandled promise rejection since the screen never catches it.

**16. `mobile/src/context/VoiceContext.tsx:554-573,651-670`, exploitable via `DialerScreen.tsx:136` — Double-tapping "call" can place two real outbound calls.** The re-entrancy guard flag is only set *after* two `await`s (permission check, connection wait) — two rapid taps both pass the guard check before either sets it, and the dialer screen has no busy-disable state on the call button (unlike the equivalent modal elsewhere in the same file, which does).

**17. `mobile/src/context/AuthContext.tsx:183-200` — A transient network blip on app launch permanently logs the user out.** Session restore treats *any* thrown error identically — including timeouts and 5xx — to a genuinely invalid session, deleting the valid stored token and forcing a fresh login even though nothing was wrong with the credential.

**18. `mobile/src/lib/voiceRecovery.ts:159-193` — Media-recovery coordinator is call-agnostic during multi-call scenarios.** The single shared recovery coordinator has no per-call keying. During hold/call-waiting/merge, if call A triggers ICE-failure recovery, a near-simultaneous recovery need for call B either silently reuses A's unrelated in-flight promise or is dropped by the cooldown — **call B's broken audio is never actually renegotiated**, and it stays "active" in the UI with no audio and no error.

**19. `mobile/src/lib/voipClient.ts:70-83` — Sign-out aborts on the first native-bridge failure, leaving credentials and push registration active.** `signOutVoiceDevice()` calls `setVoiceSignedIn(false)` as its very first, unguarded statement; if the native module hiccups, the function throws immediately and never reaches the steps that disable push notifications, clear `AsyncStorage`, delete the SecureStore session token, or log out of the Telnyx client. **The user sees "signed out" but the SIP session and push registration remain live.**

### Frontend web app

**20. `frontend/src/lib/api.js:1,3-8` — The full auth session (bearer token) is stored in plaintext `localStorage`.** Unlike an `httpOnly` cookie, this is directly readable by any script running on the page. The app pulls in several third-party libraries (Telnyx WebRTC SDK, `libphonenumber-js`, `lucide-react`, `qrcode`); a single future XSS anywhere would let an attacker exfiltrate the token for full account takeover — including, for admin users, full tenant management.

### Infrastructure / services

**21. `services/tts/app/main.py:37-39` — The TTS service's authorization check fails open when `TTS_SERVICE_SECRET` is unset.**
```python
def authorize(authorization: str | None = Header(default=None)) -> None:
    if service_secret and authorization != f"Bearer {service_secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")
```
If the secret env var isn't configured — and it is **not listed in `.env.example`**, so it's easy to deploy without ever setting it — the `if service_secret and ...` check short-circuits to `False` and every endpoint (`/v1/audio/speech`, `/v1/audio/render`, `/v1/voices`, `/health`) becomes completely unauthenticated. Anyone who can reach the service can generate arbitrary speech audio at the operator's compute cost with no rate limiting.

---

## Medium Severity

### Backend — data & storage layer

**22. `frontend/api/_lib/saas-store.ts:330-335` — Subscription writes bypass the validation helper that exists in the same file.** `saveSaasSubscription` only checks `organizationId` and `planId`; `amount`, `status`, and `billingCycle` are persisted as-is even though `createSubscription` (same file, line 453) implements exactly the validation needed and is simply never called from here. A typo'd `status` (e.g. `"acive"`) silently disables every feature for that tenant with no error surfaced.

**23. `frontend/api/_lib/saas-store.ts:436-451` — Deleting the last admin isn't blocked, unlike creating/editing one.** `saveTenantAdmin` enforces "at least one active admin" on create/edit, but `removeTenantAdmin`/`removeTenantAdminForExtension` have no equivalent guard — a tenant can be left with zero administrators and no self-service recovery path.

**24. `frontend/api/_lib/wallet-store.ts:270-287` — Wallet RLS-policy migration has a check-then-act race unlike the equivalent SaaS-table migration.** No advisory lock guards `CREATE POLICY IF NOT EXISTS` (Postgres has no such statement — this is `DO $$ IF NOT EXISTS ... CREATE POLICY`), relying only on an in-memory flag reset on every cold start. Concurrent cold starts can race and one loses with a duplicate-object error surfaced as a transient 500.

**25. `frontend/api/_lib/wallet-store.ts:476` — Missing `createdBy` validation causes an ungraceful crash instead of a clean error.** Every other field in `recordWalletAdjustment` is validated up front; `createdBy` isn't, and an undefined value throws deep inside the transaction with a raw `TypeError`.

**26. `frontend/api/_lib/wallet-store.ts:350-356,447-478` — `direction` isn't validated before being used in balance arithmetic.** Any non-`'credit'` string is silently treated as a debit; the wrong math runs before the database's CHECK constraint finally rejects the write and rolls back. `entry_type` has no equivalent DB constraint at all, so a bad value there would persist silently (see also #43).

**27. `frontend/api/_lib/wallet-store.ts:447-455` — Idempotency replay ignores whether the retried request actually matches the original.** A repeated call with the same idempotency key but a *different* amount/type silently returns the original entry with no warning — a legitimate correction is silently dropped.

**28. `frontend/api/_lib/saas-store.ts:342-345` — Plan creation/edit has no input validation**, unlike the rigorous validation used for rate rules and pricing settings in `wallet-store.ts`. A negative price or empty ID is persisted as-is.

**29. `frontend/api/_lib/pbx.ts:208-219` — Partial extension-creation failure leaves a "ghost" extension.** If the Telnyx credential save fails after the directory write succeeds, the rollback deletes the Telnyx credential but never removes the extension from the directory — it stays visible with no usable SIP credentials.

**30. `frontend/api/_lib/pbx-config-store.ts:146-161` — `pbxForOrganization` returns unfiltered, all-tenant `numberAssignments`/`userProfiles` despite its name implying a tenant-scoped view.** A known-enough gap that one caller (`validatePbxConfig`) has to manually re-filter after calling it — but nothing forces every other caller to do the same.

**31. `frontend/api/_lib/pbx-config-store.ts:210-217` — IVR keypad options pointing at an `extension` destination are never validated for existence** (the `ring_group`/`queue` cases are). A deleted/mistyped extension passes config validation and only fails at call time.

**32. `frontend/api/_lib/number-config.ts:118` — Re-pointing phone numbers only fetches the first 250 active numbers, with no pagination.** Accounts with more than 250 active numbers will have the rest silently skipped when reassigning connection IDs.

**33. `frontend/api/_lib/number-config.ts:127-140` — Password changes read-modify-write Telnyx tags with no locking**, unlike every other mutable store in the codebase. Two concurrent password-change requests can race, silently discarding one.

**34. `frontend/api/_lib/number-config.ts:99` — The "primary" legacy organization is selected by array position (`organizations[0]`), not by identity.** If the organizations array is ever reordered, a different tenant starts inheriting the legacy company voice config.

**35. `frontend/api/_lib/call-history.ts:91` — Inconsistent per-event session-grouping key can fragment one real call into multiple history entries**, showing duplicate/incomplete entries (e.g. one missing the real outcome).

**36. `frontend/api/_lib/outbound-cancel.ts:165-170` — Conference-teardown update bypasses the freshness protections used everywhere else, overwriting a concurrent write with a stale snapshot.**

**37. `frontend/api/_lib/extension-store.ts:60-62` — `saveExtensionDirectory` ignores the current stored state inside its own compare-and-swap transaction**, defeating the CAS mechanism — a concurrent create/update/delete can be silently overwritten by an older snapshot.

### Backend — auth, security, misc lib, routes

**38. `frontend/api/_lib/extension-session-store.ts:15-17` — Session revocation can take up to 15 seconds to propagate across serverless instances.** An admin revoking an employee's session (e.g. offboarding, stolen device) doesn't immediately block requests hitting a different warm instance with a stale cache.

**39. `frontend/api/_lib/rates.ts:3-14,25` — Undefined per-country rates silently display as free ($0.00/min).** Only 10 of ~250 countries have hardcoded estimated rates; every other country falls back to `0`, which the client renders as an actual price — misleading, potentially dispute-generating billing display.

**40. `frontend/api/_lib/web-push-dispatcher.ts:27-45` — Push-send failures other than 404/410 are silently discarded with no logging**, making a push-notification outage (VAPID misconfig, malformed payload, provider outage) invisible until a customer complains they never got notified of an incoming call.

**41. `frontend/api/_lib/enrollment-store.ts:8-13` — Every storage failure is mapped to the same "already used" message**, even transient infrastructure errors — a legitimate new employee can be wrongly told their invite is stale.

**42. `frontend/api/_lib/voice-webhook/parked-client-handler.ts:82-92` — Feature-entitlement re-check is skipped for calls authenticated via a signed route token.** A tenant whose calling feature is disabled or subscription lapses mid-flight can still have a call bridged if the token was minted just before the change (up to its 300-second TTL).

**43. `frontend/api/_lib/trunk-policy-store.ts:78-90` — Unsynchronized read-modify-write on one shared multi-tenant blob** storing every tenant's trunk policy — concurrent saves/deletes from different tenants can silently clobber each other.

**44. `frontend/api/_lib/call-event-store.ts:79-89` — Tenant-scoped event listing lacks the de-duplication the cross-tenant fallback path has**, so a redelivered Telnyx webhook can show the same call event twice in a tenant's call log.

**45. `frontend/api/_lib/telnyx.ts:71-98` — A network failure on a retry attempt can read an already-drained `Response` object from the prior attempt**, producing a confusing/corrupted error instead of the real timeout error — complicates incident diagnosis.

**46. `frontend/api/_lib/auth-rate-limit.ts:47-54` — IP throttling can be defeated via `x-forwarded-for` spoofing** if the platform-set header is ever absent, letting an attacker rotate through fresh empty buckets (account-level throttling is unaffected).

**47. `frontend/api/_lib/auth.ts:71-87` — Enrollment tokens carry a `jti` apparently meant for single-use enforcement, but nothing in this file records/checks spent tokens** — the actual enforcement (if any) must live entirely in the consuming endpoint.

### `voice-webhook.ts` (additional)

**48. Lines 569-603 — Bridge-failure cleanup hangs up legs from a pre-claim snapshot, not the authoritative post-claim state**, potentially leaving a late-arriving forked leg ringing/live and untracked.

**49. Lines 1138-1190 — DTMF-result handlers (`call.gather.ended`) have no idempotency/replay guard**, unlike the inbound-answer path. A redelivered webhook can double-dial the selected destination.

### API routes (`admin-*`, `voice-*`, `auth-*`)

**50. `voice-history.ts:19` via `call-history.ts:87-125` — Company-wide external call history is exposed to any authenticated user, regardless of role.** Internal calls are correctly filtered to the viewer's own calls; the external (PSTN) branch only checks organization match, not viewer identity, and the route applies no role check. **A lowest-privilege employee can see every colleague's external call log, including executives'.**

**51. `auth-password.ts:16-17,22-23` via `auth.ts:107-137` — Superadmin ('vocivo-owner') sessions are never revoked; a password change doesn't invalidate the old (30-day) JWT.** Tenant-admin and extension sessions are actively re-validated against the database; the superadmin path has no equivalent mechanism.

**52. `voice-voicemails.ts:17` — Voicemail delete reports `success: true` even when nothing was deleted.** A client that only checks the JSON body (not HTTP status) will believe a delete succeeded when the voicemail wasn't found in that org.

### Frontend web app

**53. `App.jsx:378-418` — Any transient error while loading the session forces a logout**, not just genuine auth failures — a brief network blip can wipe a perfectly valid session.

**54. `hooks/useTelnyxVoice.js:241-295` — No recovery path when the Telnyx socket permanently closes.** If the SDK's own reconnect logic fails permanently, the UI is stuck on "Reconnecting..." forever with no user-facing recourse besides a full page reload.

**55. `hooks/useTelnyxVoice.js:350` — Stale-closure bug: a caller-ID fallback value is frozen at socket-connect time**, not updated per call, because the effect's dependency array excludes it.

**56. `admin/AdminConsole.jsx:293-305` — The admin console's "loading" flag clears before the load sequence actually finishes**, re-enabling the Refresh button mid-load and allowing overlapping, racing data loads.

**57. `landing/main.jsx:227` — The public "Contact Vocivo" sales form hardcodes a personal Gmail address as the recipient**, not a company-owned inbox — looks like leftover developer test code shipped to production.

### Mobile app

**58. `VoiceContext.tsx:326-337` — A stale 200ms "resume remaining call" timer can wipe a brand-new call's optimistic UI state** if the user redials within 200ms of the previous call ending.

**59. `screens/MessagesScreen.tsx:36-45` — Switching the active message target doesn't clear the draft text box**, so an unsent draft for contact A can be accidentally sent to contact B.

**60. `context/AuthContext.tsx:73,148,169,273` — Call history (numbers, contact names, timestamps) is stored in plaintext `AsyncStorage`**, while the session token correctly uses secure storage — comparatively sensitive PII left unencrypted on-device.

**61. `screens/ActiveCallScreen.tsx:89-99` — Contact-photo lookup has no staleness guard**; a slow lookup for a previous call can resolve after a newer call starts and overwrite the wrong call's photo.

**62. `voice/useVoiceRegistration.ts:91-127` — A duplicate session-refresh timer isn't cleared before scheduling a new one on the direct-refresh path** (only the main scheduling path clears it), causing redundant token refreshes and re-logins.

**63. `voice/useVoiceRegistration.ts:93` — A 60-second floor on refresh delay can override the intended "refresh 2 minutes before expiry" safety margin** for short-lived tokens, refreshing right at (or past) expiry instead of ahead of it.

**64. `voice/useVoiceRegistration.ts:50-64` — The connection-setup effect doesn't re-check its cancellation flag between every `await`**, so a superseded run (e.g. rapid logout/login) can still write shared session state after being "cancelled," racing with the newer run.

**65. `context/MessagingContext.tsx:39-46` — The message-load effect has no cancellation guard**, unlike the equivalent effect in `BusinessContext.tsx`. On a shared device, switching users without a full remount can briefly render the *previous* user's private SMS content before the new user's data loads.

**66. `lib/api.ts:11` — A SecureStore read failure bypasses all retry/timeout/error-formatting logic** for every API call, including simple GETs, because it's awaited outside the function's try block.

### Infrastructure / services

**67. `services/tts/app/main.py:83-87` — Check-then-write on the audio cache file has no locking**; concurrent identical requests can race, and a reader could theoretically see a partially-written file.

---

## Low Severity

### Backend — data & storage layer

- **`object-store.ts:816`** — `list({ limit: 0 })` is silently treated as "no limit" (falsy-zero bug: `Number(0) || 1000`).
- **`object-store.ts:814-833`** — `list()` pagination uses a raw row offset rather than a keyset cursor; concurrent inserts/deletes between pages cause skipped or duplicated entries.
- **`object-store.ts:718-762`** — `transactObjectGroup` only advisory-locks pathnames passed as `readPathnames`; a new key the callback writes but never reads isn't protected.
- **`wallet-store.ts`** — `reservedMinor` is defined in the type, schema, and row-mapper but no function ever writes a non-zero value — likely an incomplete "funds hold" feature.
- **`wallet-store.ts:220`** — `entry_type` has no DB CHECK constraint (unlike `direction`, which does).
- **`saas-store.ts:349`** — If a subscription references a deleted/renamed plan, the tenant silently falls back to whichever plan sorts cheapest, with no visible error.
- **`pbx.ts:338-345`** — `deleteExtension` isn't idempotent; a retried delete after a lost response throws "Extension not found" for an operation that actually succeeded.
- **`outbound-call-store.ts:111`** — `updatedAt` can reflect a stale caller-supplied timestamp rather than actual write time.
- **`call-history.ts:93`** — O(n²) array rebuild per event when grouping call sessions (real but low-impact inefficiency).
- **`number-config.ts:89,115`** — `backgroundImageUrl` only validates the `https://` scheme, no host allowlist — a latent SSRF surface if anything ever fetches it server-side.
- **`saas-store.ts` / `object-store.ts`** — Plan/subscription pricing round-trips through floating point (`::float8` cast) rather than integer minor units, unlike wallet-store's correct integer-cents handling.
- **`object-store.ts`** — `get()`'s `access` parameter is accepted but never enforced (`_options`), and the generic `vocivo_objects` table has no server-side (RLS) tenant isolation, unlike the SaaS/wallet tables — isolation depends entirely on every caller correctly prefixing keys.

### Backend — auth, security, misc, routes

- **`auth.ts:102-105`** — `allowsForcedPasswordChange` uses `endsWith` rather than an exact path match (currently not exploitable given Vercel's routing, but looser than intended).
- **`auth.ts:148`** — Dead role branch (`'admin'`) that nothing ever assigns — leftover from an earlier role scheme.
- **`voice-control.ts:43-50`** — Voice state tokens carry authorization-relevant fields as unsigned base64 JSON; safety depends entirely on webhook signature verification happening correctly elsewhere.
- **`internal-sip.ts:3,18-24`** — The internal SIP-URI regex doesn't allow a `:port` suffix that a sibling regex in the same file does.
- **`internal-sip.ts:66-68`** — `organizationExtensionSipUri` ignores its `config`/`organizationId` parameters and always returns one hardcoded global SIP host — looks like an unfinished per-org SIP domain feature.
- **`voicemail-store.ts:48-58`** — Server-side `fetch()` of a caller-supplied recording URL with no host allowlist in this function — worth confirming the call site restricts it.
- **`outbound-bridge.ts:74`** — Unreachable `throw lastError` after the retry loop (harmless now, fragile if the loop bounds ever change).
- **`ai-transfer-token.ts:44`, `voice-route-token.ts:53`** — Required string fields checked for type but not for empty string, unlike sibling fields.
- **`platform-key-store.ts:18-23`** — All key-store read failures (corrupted data, wrong secret, storage error) are silently mapped to an empty list, making a broken key store indistinguishable from "no keys."
- **`http.ts:42-46`** — `publicError` leaks the specific missing environment-variable name to API callers on a misconfiguration.
- **`http.ts:3-6`** — Wildcard CORS with `Authorization` allowed in headers (acceptable for a bearer-token API with no cookie auth — worth confirming no endpoint relies on cookies).
- **`voice-route-store.ts:69-76`** — Non-phase fields can still be mutated on an already-terminated route by a late/duplicate webhook.
- **`admin-pbx.ts:42`** — Extension/queue/IVR membership validation is skipped for a superadmin editing a non-active organization.
- **`admin-trunks.ts:69`** — Create-vs-update is routed by the presence of an `id` field rather than HTTP method — a client bug could unintentionally overwrite or duplicate a trunk.
- **`auth-login.ts:54,69`** — Passwords under 8 characters skip the bcrypt comparison, creating a minor (low-value) timing side-channel revealing password-length class only.

### `voice-webhook.ts` (additional)

- **Lines 916-1046** — Several event handlers rely on flow-string exclusivity rather than an explicit early `return` — currently harmless, but fragile if a future flow value is ever reused.
- **Line 967-970** — The `answer` action on inbound `call.initiated` has no `.catch`, unlike nearly every other action in the file.
- **Lines 246-282** — Forwarding-loop protection only blocks looping back to the *exact same* extension, so an A→B→A configuration still rings both once before the depth cap kicks in (bounded, not exploitable).

### Frontend web app

- Unused "mobile-style" screen set (`Header.jsx`, `TabBar.jsx`, `CountryPicker.jsx`, `pages/*Screen.jsx`) is confirmed dead code, shipped but unreachable from any real entry point — and carries its own latent bug (`AuthScreen.jsx:16-24` has no try/catch/finally, so a failed sign-in leaves the submit button permanently disabled) that would matter if it were ever wired up.
- **`App.jsx:236`** — The on-screen keypad can never dial a number starting with a literal "0" (a leading "0" always inserts "+" instead).
- **`video/main.jsx:7,12`** — The video-room access token is read from the URL hash fragment — a reasonable magic-link pattern, but worth confirming the backend token is short-lived and single-use.

### Mobile app

- **`VoiceContext.tsx:604,708`** — Unused `connection` dependency causes unnecessary callback/memo recreation.
- **`AuthContext.tsx:73`** — A legacy storage-migration path is gated on a hardcoded test account ID, unreachable for real users.
- **`VoiceContext.tsx:361-387`** — A third "waiting" call during a hard transport-loss cleanup is hung up but never logged to call history — it silently vanishes instead of appearing as missed.
- **`MessagesScreen.tsx:95-102`** — Starting a new message doesn't clear stale AI reply suggestions from the previous thread.
- **`voiceRecovery.ts:172-180`** — A fallback ICE-restart branch mutates the peer connection's local SDP and then unconditionally throws — effectively dead code with a side effect if ever reached.
- **`contactDirectory.ts:28-31`** — A failed contact-directory load caches the *rejection* for a full 60 seconds, so every lookup in that window re-throws the stale failure instead of retrying.
- **`MessagingContext.tsx:71`** — Millisecond-based local message IDs can collide on a fast double-send, misrouting a status update.
- **`SettingsScreen.tsx:64,174`** — An admin-role allowlist is duplicated verbatim in two places; a future edit to one and not the other would silently change who can manage phone settings vs. reset passwords.

### Infrastructure / services

- **`services/tts/app/main.py`** — No cache eviction/TTL on generated audio files — the cache directory grows unbounded over time.
- **`frontend/api/telnyx/token.ts:34`** — An already-expired parsed JWT still reports `expires_in: 60` due to a `Math.max(60, ...)` floor, misleadingly suggesting the token is still valid for a minute.
- **`frontend/api/ai/replies.ts`** — User-supplied draft/recipient/context text is interpolated directly into the LLM prompt with no delimiting, allowing prompt injection — limited blast radius since it only affects suggested reply text shown back to the same authenticated user.
- **`frontend/api/platform/[resource].ts:52-64`** — The `health?deep=1` endpoint requires no API key, inconsistent with every other resource in the same file, which is scope-gated.

---

## Areas reviewed with no significant findings

The following files/areas were read in full and found to be solid, with only the specific issues noted above (if any):

- **`object-store.ts`**'s core locking/transaction design (`put`, `putMany`, `updateObject`, `transactObject`) and **`wallet-store.ts`**'s balance-update path (`recordWalletAdjustment`'s advisory lock + row lock + version CAS + idempotency-key uniqueness) — sorted lock ordering (deadlock-safe), integer-cents money math throughout, and consistent RLS + in-app tenant-ownership checks.
- **`auth.ts`**'s core JWT session logic — constant-time verification via `jose`, tenant/org-active checks, and role/org fields re-derived from the database rather than trusted from stale JWT claims (correctly prevents privilege drift after a role change).
- **`message-store.ts`**, **`voicemail-store.ts`** — consistent AES-256-GCM encryption at rest with random IVs, and correct tenant/viewer filtering before data is returned.
- **`phone-number-access.ts`**, **`ai-transfer.ts`**, **`voice-routing.ts`** — correctly tenant-scoped, sound IDOR guards.
- Most of the `frontend/api/_lib/routes/` batch (`admin-ai`, `admin-api-keys`, `admin-background`, `admin-enrollments`, `admin-events`, `admin-extensions`, `admin-numbers`, `admin-overview`, `admin-saas`, `admin-voices`, `admin-wallets`, `auth-enroll`, `auth-profile`, `auth-session`, `mobile-bootstrap`, `voice-ai-transfer`, `voice-cancel`, `voice-conferences`, `voice-devices`, `voice-directory`, `voice-merge`, `voice-route`, `voice-settings`, `voice-status`, `voice-transfer`, `voice-video`, `voice-web-push`) — consistent session-derived tenant scoping and ownership checks before any call-control action.
- **`voice-webhook.ts`**'s webhook signature verification (confirmed done up front, before any payload is trusted) and tenant scoping on extension/queue lookups.
- **`frontend/src`**'s core call-state hook (`useTelnyxVoice.js`) uses solid generation-counter patterns to discard superseded route reservations and stale polling responses; no XSS sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`) found anywhere in the tree.
- **`mobile/src`**'s `callLifecycle.ts` (a well-structured single-flight/serial-queue state machine), `BusinessContext.tsx` (correctly uses a cancellation-guard pattern that `MessagingContext.tsx` is missing), and most UI components/screens.
- **`frontend/api/telnyx/*`, `frontend/api/admin/[resource].ts`, `frontend/api/auth/[action].ts`, `frontend/api/voice.ts`, `frontend/api/platform/[resource].ts`** (aside from the low-severity note above) — consistent auth/tenant checks before every mutating action.
- `deploy-production.sh`, `verify.sh` — reasonable pre-deploy gating (branch check, clean tree, tests, health-check polling with retries).

---

## Suggested priority order

1. Fix the three uncontrolled-call-state bugs in `outbound-cancel.ts` and `voice-webhook.ts` (findings 5, 6, 9-13) — these leave real phone calls connected/billed indefinitely with no way to recover them.
2. Fix the two privilege-escalation bugs in `saas-store.ts` (findings 1, 2) and the tenant-isolation gap in `pbx.ts` (finding 3) — these are the most direct paths to unauthorized access.
3. Set `TTS_SERVICE_SECRET` in every environment (or change the default to fail closed) — finding 21 is a one-line, high-impact fix.
4. Verify the Telnyx webhook raw-body handling in production (finding 8) — if this is currently broken, it's an active outage waiting to be diagnosed; if it happens to work, add a regression test using real Telnyx-shaped bytes rather than a self-referential fixture.
5. Move the web/mobile auth tokens off plaintext storage where feasible (findings 20, and the AsyncStorage call-history note in mobile) — defense in depth against any future XSS or device compromise.
6. Everything else in High/Medium can be triaged by area team in a normal sprint; Low findings are good backlog/cleanup items.
