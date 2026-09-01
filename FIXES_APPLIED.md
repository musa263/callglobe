# CallGlobe (Vocivo) — Fixes Applied

**Date:** September 1, 2026
**Companion to:** `CODE_REVIEW_REPORT.md` (finding numbers below reference that report)
**Changes:** 62 files modified across `frontend/api`, `frontend/src`, `mobile/src`, `services/tts`, and `.env.example`. Nothing has been committed — review everything with `git diff` on the `main` branch.

## Verification — all gates pass

| Gate | Result |
|---|---|
| `frontend` `npm run check:api` (tsc over the whole API) | ✅ clean |
| `frontend` `npm test` | ✅ 133/133 pass (incl. new regression tests) |
| `frontend` `vite build` (web client compile) | ✅ builds |
| `mobile` `npm run typecheck` | ✅ clean |
| `mobile` `npm test` | ✅ 24/24 pass |

---

## High severity — 23 of 24 fixed

1. **#1, #2 `saas-store.ts`** — `role` and `status` now fall back to the existing value; editing an admin can no longer silently promote them to owner or reactivate a suspended account.
2. **#3 `pbx.ts`** — `getExtension` / `getExtensionCredentials` / `updateExtension` / `deleteExtension` accept an `expectedOrganizationId` guard (mismatch → "Extension not found", no existence leak); passed at 10 call sites across routes/webhook where the org is in scope. Cross-tenant extension-credential IDOR at the library layer is closed.
3. **#4 `pbx.ts`** — the shared extension directory build now skips (and logs) a bad record instead of failing every tenant's extension lookups.
4. **#5 `outbound-cancel.ts`** — a conference host hanging up now produces a teardown plan that hangs up the destination, all fork legs, and unlinks the peer — no more permanently-connected orphan calls.
5. **#6 `outbound-cancel.ts`** — cancellation re-reads the freshest stored pair before computing legs to hang up; concurrently-added legs are terminated and tracking is only cleared when every fresh leg is down.
6. **#7 `auth-rate-limit.ts`** — a successful login now clears only the account-scoped failure bucket; the shared per-IP brute-force counter survives, closing the password-spray bypass.
7. **#8 `telnyx-webhook-auth.ts`** — root cause confirmed empirically: Vercel's body helper replays raw bytes only through `req.on('data'/'end')`, which the old `for await` iteration bypassed (verified with a live reproduction of Vercel's `restoreBody`). The reader now uses the event API, so signatures verify against the true signed bytes. A new regression test signs whitespace-formatted wire bytes (which `JSON.stringify` cannot reproduce) through a faithful mock of Vercel's stream replay.
8. **#9–#13 `voice-webhook.ts` (+ `queue-call-store.ts`)** — queue/ring-group bridging now uses an atomic CAS claim (new `claimQueueCallStatus`, modeled on the outbound-call-store transaction pattern) so two answering agents can't double-bridge; `call.enqueued` and all three `call.gather.ended` handlers gained replay guards (`claimReplayKey`) so webhook redeliveries can't double-dial; conference creation failures now hang up the host instead of leaving dead air; the main inbound dial path is wrapped so any dial/enqueue failure routes the caller to the unavailable/voicemail fallback or hangs up instead of stranding them; caller waiting-audio/active-route state is only updated when the bridge is actually issued.
9. **#14–#18 mobile** — mute/hold indicators are keyed to the call that emitted the event; mute/hold/speaker toggles catch native failures; the dial re-entrancy guard is set synchronously (double-tap can't place two calls); session restore only logs out on real 401/403 (network blips no longer wipe a valid token — `mobile/lib/api.ts` now attaches `status` to HTTP errors to enable this); media recovery is keyed per call so one call's recovery can't starve another's.
10. **#19 `voipClient.ts`** — sign-out now runs every cleanup step (push unregister, storage clears, SecureStore delete, SDK logout) even if one fails, logging failures — no more "signed out" with live credentials.
11. **#21 `services/tts/app/main.py`** — authorization fails closed (503 if `TTS_SERVICE_SECRET` unset), uses a timing-safe compare, and `TTS_SERVICE_SECRET` was added to `.env.example`. Cache writes are now atomic (temp file + rename). **Action needed: set `TTS_SERVICE_SECRET` wherever the TTS service is deployed, or it will refuse requests.**

**Not fixed (1):** **#20** — web session token in `localStorage`. Moving to httpOnly cookies is an architectural change spanning backend session issuance, CORS, and CSRF handling; recommended as follow-up work, below.

## Medium severity — 45 of 52 fixed

Backend: subscription writes now pass through the validating sanitizer (#22); deleting the last active admin of a business tenant is blocked (#23); the wallet RLS migration is advisory-locked + migration-gated like the SaaS one (#24 — note: first deploy runs the gated block once, all statements idempotent); `createdBy`/`direction`/`type` validated up front (#25, #26); idempotency-key reuse with different parameters now errors instead of silently returning the old entry (#27); plan saves validated (#28); extension-creation rollback removes the ghost directory entry (#29); `pbxForOrganization` filters `numberAssignments` per tenant (#30 — `userProfiles` left as-is: keyed by extension id with no org field, and filtering would break secondary-org routing); phone-number re-pointing follows pagination (#32); one-department configs accepted (#31→#11 in agent numbering); call-history session grouping uses a two-pass leg→session map (#35); conference teardown and directory seeding no longer clobber concurrent writes (#36, #37); revocation cache TTL cut 15s→5s (#38); push failures are logged (#40); enrollment errors distinguish "already used" from infrastructure failure (#41); entitlements are re-checked on the signed-token path (#42); trunk-policy saves are transactional (#43); per-org event listing de-dupes (#44); the Telnyx retry loop can't read a drained response (#45); IP extraction no longer trusts spoofable headers (#46); **superadmin sessions are now revocable** — a password change writes an invalidation timestamp and both `requireSession` and `requireOwner` reject older tokens (#51, done properly across both entry points); external call history is viewer-scoped for regular users while owner/admin roles keep the org view (#50); voicemail delete returns an honest 404 (#52).

Web: session bootstrap only logs out on 401/403 (#53); the voice socket now self-recovers with bounded backoff by forcing a fresh login (#54); the dialed-number stale closure uses a ref (#55); the admin console busy flag holds until the load finishes (#56).

Mobile: stale resume timer can't wipe a new call (#58); switching message targets clears the draft and suggestions (#59); photo lookups ignore superseded calls (#61); refresh timers are cleared before reassignment (#62); short-lived tokens refresh at half-life instead of at expiry (#63); the registration effect re-checks cancellation after every await (#64); the messaging load effect has a cancellation guard (#65); a keychain read failure degrades to an unauthenticated request instead of a raw crash (#66). TTS cache writes are atomic (#67).

**Not fixed (7), with reasons:**
- **#31 (IVR extension-target validation)** — on re-inspection, targets are async-store extension *IDs*; validating them in the sync config validator would need a circular import, and runtime already degrades gracefully. Reclassified: not worth the risk.
- **#33 (Telnyx tag read-modify-write)** — the Telnyx tags API has no compare-and-swap primitive; nothing to build on.
- **#34 (`organizations[0]` legacy primary)** — needs a product decision about which org owns the legacy config.
- **#39 (unknown countries shown as $0.00/min)** — the in-code comment says older shipped mobile builds crash on `null` rates; fixing the display needs a coordinated client rollout. Flagged for you.
- **#47 (enrollment jti)** — verified already enforced: the enroll route consumes the jti through the single-use store. Not a bug.
- **#57 (contact form → mr.musausman@gmail.com)** — that's your own address; left for you to decide.
- **#60 (call history in plaintext AsyncStorage)** — SecureStore's size limits don't fit history blobs; encrypting needs a small design pass. Recommended below.

## Low severity — 32 of 44 fixed

Fixed highlights: `list({limit: 0})` no longer means 1000; unknown-plan fallback logs a warning; `deleteExtension` is retry-idempotent (Telnyx 404 = success); `updatedAt` reflects real write time; O(n²) history grouping removed; exact-path match in `allowsForcedPasswordChange`; dead `'admin'` role branch removed (repo-wide grep confirmed nothing sets it); SIP URI regex accepts `:port` (+ test); empty-string token fields rejected; platform-key store failures logged; env-var names no longer leak in error responses; explicit `return`s added to webhook handler blocks; the unlogged `answer` action got its standard `.catch`; trunk create/update is routed by HTTP method; bcrypt always runs on login (timing signal removed); keypad taps insert a literal 0 with `+` on long-press; the dead-code AuthScreen's stuck-loading bug fixed; contact-directory failures retry immediately; message local-IDs are collision-proof; the duplicated role allowlist is a single constant; unused deps/dead recovery-branch mutations removed; SSRF trust boundary documented at `storeVoicemailAudio`.

**Left as-is (12), with reasons:** object-store design items (unenforced `access` option, no RLS on `vocivo_objects`, float plan pricing, offset pagination, `transactObjectGroup` lock scope, unused `reservedMinor`, `entry_type` DB CHECK — schema/design changes; the new JS validation covers the last one at the app layer); encryption-key domain separation (changing it would make existing stored config undecryptable — needs a migration); CORS wildcard (intentional for a bearer-token API); video token in URL hash (acceptable short-lived magic-link); dead-screen removal (your call — `frontend/src/pages/*Screen.jsx`, `Header/TabBar/CountryPicker` are unreachable from any entry point); forwarding-loop tightening (needs a visited-set design); `voice-route-store` terminal-field writes (blocking them could drop legitimate late metadata); `admin-pbx` superadmin validation "bypass" (**false alarm on re-inspection** — the save path discards the unvalidated data in exactly that case); unauthenticated `/api/health` (intentional — the deploy script polls it); `expires_in` 60s floor (protects clients from refresh loops on clock skew).

---

## Recommended follow-ups (need your decision)

1. **Web auth token storage** — move the session from `localStorage` to an httpOnly cookie (backend work: cookie issuance, CSRF token, CORS credentials). Until then, any future XSS = full account takeover.
2. **Rates display** — decide how unknown-country rates should render (needs mobile+web client updates in one release; older builds reportedly crash on `null`).
3. **Mobile call-history encryption** — encrypt the AsyncStorage history blob with a key held in SecureStore.
4. **Dead code** — delete the unused screen set in `frontend/src` if you don't plan to revive it.
5. **Contact form email** — confirm `mr.musausman@gmail.com` is the intended sales inbox on the public landing page.
6. **Deploy note** — set `TTS_SERVICE_SECRET` in the TTS service's environment before deploying `services/tts`, or it now (correctly) refuses all requests.

## Housekeeping notes

- Test tooling only: `@esbuild/linux-arm64` was installed with `--no-save` into `frontend/` and `mobile/` `node_modules` so the test suites could run in this session's Linux VM alongside your Mac's darwin binaries. `package.json` and lockfiles are untouched; a fresh `npm ci` on your Mac is unaffected.
- A `_to_delete/` folder at the repo root holds two vite temp files and a stale `.git/index.lock` that this session couldn't delete (deletion is blocked without permission) — you can remove the folder.
- Nothing was committed. Suggested review flow: `git diff` (62 modified files), then commit when satisfied.
