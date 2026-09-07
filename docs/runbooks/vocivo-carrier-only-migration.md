# Vocivo control / Telnyx carrier migration

This is a staged implementation and rollout record. Stage 1 identity adoption is
live; full device/carrier acceptance remains open. Target: Telnyx supplies SIP trunks, public numbers, carrier SMS and usage;
Vocivo owns application identities, PBX, clients, AI orchestration and video.

## Sequence and status

1. Independent extension identities: deployed and adopted in production; mobile
   answer-transition issue and remaining acceptance gates are open.
2. Complete SIP calling and mobile native integration: started locally with managed
   JavaScript runtime isolation; native dependency removal and feature parity pending.
3. Migrate inbound PBX and receptionist execution: pending live verification/cutover.
4. Remove managed AI, verification and video dependencies: pending.
5. Retire unused managed carrier resources/SDKs: pending acceptance of replacement paths.

Do not retire any carrier resource just because stage 1 is available. Production
adoption does not establish complete device or carrier acceptance. Carrier credentials are retained
but are no longer read by the local lifecycle after adoption.

## Stage 1 contracts

- Encrypted directory version 3 records `authority: vocivo`. Default deployments
  with legacy directories retain their existing managed behavior until adoption.
- Adoption preserves extension IDs, tenant IDs, extension numbers, SIP usernames,
  roles, status, names and creation dates. It changes provider labels to `vocivo`.
  Existing profile, history, admin-account and device references keep their IDs.
- Local lifecycle does not create, refresh, update or delete Telnyx credentials.
  New extensions use random Vocivo IDs and SIP usernames; device/session passwords
  continue through `/api/voice/sip-credentials` and the existing encrypted store.
- Directory mutation is atomic. Auto-allocation resolves slots inside the
  transaction; tenant reassignment and changing the underlying identity are denied.
  Updates use current rows and do not resurrect a concurrent deletion.
- Deletion/edit revokes extension sessions. New SIP registrations check current
  identity/access. This does not prove immediate removal of existing registrar
  contacts or termination of active calls; those are SIP rollout acceptance gates.
- Invalid stored data fails closed. The migration cannot replace unreadable bytes
  with an empty directory or import fallback carrier identities over them.
- `/api/voice/config` exposes both `voice_edge` and `extension_authority`.
  `/api/telnyx/token` rejects SIP-mode clients; old stored carrier credentials cannot
  be requested through the adopted directory lifecycle.

## Dry-run and deployment order

1. Back up the database and establish a restore point. Inventory directory IDs,
   linked account IDs and active client versions through authorized tools; do not
   put credentials or employee details in logs. Populate an absent legacy directory
   using the existing managed application before adopting existing accounts. Review
   any pending legacy SIP-identity reconciliation before migration.
2. Deploy this stage's v3-aware API code while retaining the existing directory.
   Do not perform adoption with older writers still running. Pause provisioning
   and administrative edits and drain in-flight requests for the cutover.
3. Validate the SIP stack and mobile builds. Verify `VOCIVO_VOICE_EDGE=sip` and
   `VOCIVO_SIP_INBOUND=1` in the actual deployed API environment, plus matching
   SIP-host configuration and Telnyx DID assignments. An env file alone does not
   establish deployed behavior or working audio.
4. From `frontend`, run against a protected environment file for the selected
   database:

   ```sh
   node --import tsx scripts/migrate-extension-authority.mjs --env-file /protected/env
   ```

   The default is read-only. It reports counts, revision, structural identity
   validity and configured engine readiness without employee/credential output.
   Missing directories are refused. Only a confirmed new installation may use
   `--initialize-empty`; it does not erase an existing directory.
5. After the dry-run and deployment gates, apply:

   ```sh
   node --import tsx scripts/migrate-extension-authority.mjs --env-file /protected/env --apply
   ```

   Adoption is transactional, refuses a changed source revision and is idempotent.
   It verifies the stored authority afterward. It does not change environment
   variables, Telnyx resources, user passwords or deployment settings.
6. Verify signed-in config reports `extension_authority: vocivo`; compare IDs and
   account/history links with the pre-migration inventory. Exercise create/edit/
   delete, tenant denial, account login and SIP credential issuance. Check internal
   calls without Telnyx management API access, then carrier inbound/outbound calls,
   audio in both directions, and foreground/background/locked-device ringing.
7. Resume administrative writes only after those checks. Keep carrier records
   archived until later retirement work is explicitly performed.

## Rollback boundary

An env-only rollback to managed Telnyx is deliberately rejected after adoption.
New local users have no carrier credentials; deleted users may still have archived
carrier records. Do not deploy pre-v3 binaries or blindly restore a backup after
accepting new writes. Repair forward using a compatible build, or stop writes and
perform a separately reviewed reconciliation of users, credentials and account
links before restoring managed service. Carrier record retention is not automatic
rollback support.

## Validation

Run `bash verify.sh` and the focused `vocivo-extensions.test.ts` regression suite.
The suite uses the real encrypted directory codec with an in-memory serialized
transaction adapter. External fetch calls are prohibited. It covers preservation,
duplicates, corruption, revision races, allocation concurrency, tenant checks,
immutable IDs/usernames, individual roles, revocation failure and deletion races.
It does not connect to production PostgreSQL or prove device/carrier behavior.


## September 7 readiness evidence

- Pre-cutover directory inspection: three structurally valid identities,
  revision 2 under `telnyx` authority. The subsequent adoption is recorded below.
- SIP host status run [34111719056](https://github.com/musa263/vocivo/actions/runs/34111719056)
  succeeded: SIP inbound enabled, FreeSWITCH healthy, Kamailio/coturn/rtpengine
  running, Telnyx gateway UP. This is service status, not RTP acceptance.
- The live API returned HTTP 200 with a dialplan for the active carrier number
  through authenticated `/api/voice/sip-dialplan`. The check placed no calls.
  Carrier-to-trunk assignment and actual inbound delivery still need acceptance.
- Vercel exports hide sensitive values as empty strings. In particular, an empty
  exported inbound flag or trunk connection ID does not prove it is unset in the
  deployed runtime. Migration dry-run reports unknown engine readiness for an
  incomplete export; apply still requires explicit valid engine settings.
- A connected iPhone has Vocivo 1.0.0 build 60. Version inspection alone does not
  establish its source revision or prove these local changes are installed.
  Foreground and locked-screen internal calls passed as recorded below.
  The controlled app-closed repeat confirmed ringing, connection and audio in
  both directions. No Android device is available for this session.
- Do not mark Stage 1 production complete until compatible API rollout, adoption,
  identity/link checks and the device/carrier gates above are recorded as passed.

## Stage 2 first implementation slice

`managedVoiceRuntime.tsx` loads the Telnyx JavaScript SDK lazily. SIP startup,
shared native controls and sign-out do not create the managed client. VoiceRoot
mounts its managed runtime only after authenticated configuration explicitly
selects Telnyx and the hook has prepared/persisted that session. Managed push
bootstrap is handled by that same hook, avoiding competing token refreshes.
Missing/invalid engine configuration fails closed and retries.

The SIP “refresh incoming calls” action renews Vocivo SIP credentials and posts
its native wakeup token to Vocivo. It does not request a Telnyx token or log in to
Telnyx; errors leave push status unavailable instead of indefinitely registering.

This is not removal of the native SDK. `nativeVoiceBridge.ts` still uses the
existing VoicePnBridge module supplied by the patched Telnyx native integration.
Push-token access, ringtone preferences and some platform controls must move to
Vocivo-owned native modules before removing that package/plugin. Next: implement
and compile those native contracts on both platforms, then run physical-device
push/CallKit/Telecom/audio acceptance before shipping a replacement build.

Regression coverage: ManagedRuntimeIsolation proves lazy initialization and native
control behavior; VoiceRegistration checks managed push persistence ordering;
VoiceContext checks SIP refresh success/failure without carrier-token requests.
These are mocked integration tests, separate from the physical acceptance gates.

Local verification for this slice: `bash verify.sh` passed 431 backend/web tests,
137 mobile unit tests and 81 mobile integration tests, API/mobile type checks and
the web build. These counts reflect the shared checkout, which also contains
other ongoing work; they do not establish deployed-code or device acceptance.

## Physical iPhone acceptance — September 7, 10:53 UTC

- Target: user-confirmed extension 2003 on the connected iPhone, installed build
  60. Caller: the signed-in production web phone using the free internal route.
- Foreground call: browser displayed LIVE CALL and an advancing timer. The user
  confirmed iPhone ringing, answer and audible speech in both directions.
- The browser ended the test call after approximately 38 seconds. This records
  the action, not yet confirmation that native call UI cleared on the iPhone.
- Locked-screen call: user confirmed incoming CallKit UI, answer without opening
  Vocivo and two-way audio. The browser displayed LIVE CALL; after the user ended
  the call, it returned to Ready. Stored events show answer at 10:55:09 UTC and
  NORMAL_CLEARING at 10:55:45 UTC.
- First app-closed/locked attempt: user reported connection/two-way audio, but the
  browser never left Calling and then displayed unavailable. Stored events show
  initiation at 10:56:25 UTC and NO_ANSWER at 10:57:10 UTC, with no answered event.
  The captured Kamailio trace has no matching answer ACK. This conflicting result
  is not accepted as a pass. The user subsequently said the closing instructions
  were unclear; they were simplified before the controlled repeat below.
- Trace: [34114397558](https://github.com/musa263/vocivo/actions/runs/34114397558).
  Repeated Digest-replay rejections also appear around the test window; they are
  a diagnostic lead, not an established cause of the app-closed result.
- These checks occurred before adoption and do not validate the unshipped
  Stage 2 changes. Post-adoption behavior is recorded below.

### Controlled app-closed repeat — September 7, 11:11 UTC

- After clarified instructions to open Vocivo, swipe its app-switcher card away
  and lock the iPhone, the user confirmed ready. The browser called extension 2003
  again through the free internal route.
- User confirmed ringing and audible Mac-to-iPhone speech. The browser displayed
  LIVE CALL and an advancing timer, including at 01:27.
- Stored events: initiated 11:11:11 UTC, answered 11:11:26 UTC, normal hangup
  11:13:35 UTC. Connected duration was 129 seconds. The browser ended this call
  and returned to Ready. This supersedes neither the earlier NO_ANSWER record nor
  its uncertain cause, but establishes successful delivery on this repeat.
- User separately confirmed audible iPhone-to-Mac audio after the call. The
  controlled repeat therefore passed ringing, answer, two-way audio and normal
  hangup with Vocivo closed and the iPhone locked.

## Production identity cutover — September 7

- Promoted deployment `dpl_Br7oXyohGUi1RNDbUAwDpghghusz` to `vocivo.app`.
  The isolated candidate used 364 source files verified against the prior live
  deployment and changed only the eight Stage 1 files. No mobile build shipped.
- Candidate validation: 13 focused directory tests, 410 backend/web tests,
  API typecheck and web build passed. Vercel completed the build but emitted
  TS2550 for an unchanged AI `Array.at` use; this is not a warning-free build.
- Provisioning edits were paused and the previous request window drained before
  adoption. The first apply returned a verification failure; a read-only check
  proved the exact pre-migration directory bytes and revision remained intact.
  The second attempt, using a longer database connection timeout, succeeded.
  A transient timeout is a hypothesis, not an established cause of the first failure.
- Stored directory is now revision 3, `authority: vocivo`, with all three
  identities preserved by fingerprint excluding only the changed provider label.
  Signed-in live config reports `extension_authority: vocivo`, `voice_edge: sip`.
  Carrier resources were not changed and old carrier credentials remain archived.
- A protected local archive in ignored `tmp/vocivo-stage1-cutover-20260907/`
  contains the encrypted directory backup, integrity manifest and exact changed
  release files. This backs up the one migrated record, not the whole database.
  Do not restore it over subsequent writes or roll back to a pre-v3 API.

### Post-adoption internal call — unresolved mobile acceptance

- Call `lrlla2a0lm88nc0q5ndt`, route `vc_mtr6p4en_2s29zk61`, targeted extension
  2003 on iPhone build 60. Stored events show initiation at 11:55:44 UTC,
  answer at 11:56:01 and NORMAL_CLEARING at 12:01:32 (331 connected seconds).
- User reported an apparent disconnect/reconnect at answer followed by audible
  speech, then clarified that the phone showed the dial pad. Browser remained
  LIVE CALL. This is not accepted as a clean answer/UI pass.
- [SIP trace 34119739496](https://github.com/musa263/vocivo/actions/runs/34119739496)
  shows the answer ACK at 11:56:01.845 and the first matching BYE at
  12:01:32.388, when the browser ended the test. There is no recorded SIP hangup
  or second call setup during the reported transition.
- The same trace shows extension 2003 receiving an expired-nonce challenge at
  11:55:52 and two `password_mismatch` rejections at 11:55:56 and 11:55:57.
  These precede answer and require credential-generation/client correlation;
  they do not prove the migration changed a password or establish the UI cause.
  The caller also encountered an empty auth response during setup. Repeated
  Digest-replay rejections remain a separate diagnostic lead.
- Browser console recorded overlapping REGISTER attempts at 11:54:58 and
  11:55:00. Installed SIP.js 0.21.2 resolves `register()` after sending, before
  the final registrar response; the keeper currently retries while the initial
  registration is pending. A send-promise lock alone does not serialize that
  transaction. Fix and test final-response coordination before calling this clean.
- Code inspection also shows native push/Answer can precede the real INVITE,
  while the React active-call screen requires a call object. A pending-answer UI
  gap is a plausible explanation for the dial-pad report, but no native event
  trace or source-matched build-60 reproduction establishes it yet. Do not change
  terminal-call handling or weaken authentication based on this hypothesis.
- Next acceptance work: capture a source-matched mobile answer trace, fix the
  reproduced registration/UI defects, ship a new mobile build and repeat locked
  and app-closed answers. Android, carrier inbound/outbound audio, and live
  extension administration/access-revocation gates remain unverified.

## Git release checkpoint — September 7

The Stage 1 release commit is based on remote main `6e01784` and contains the
eight previously deployed Stage 1 files plus this runbook, organization contracts
and the Stage 1 architecture note. Their implementation hashes match the protected
cutover manifest. No unfinished Stage 2 mobile changes are included. The Stage 2
implementation notes above describe work in the development checkout, not code
in this release commit.

`bash verify.sh` passed on the isolated release checkout: 410 backend/web tests,
135 mobile unit tests, 53 mobile integration tests, both typechecks and the web
build. Native iPhone acceptance remains open as recorded above; passing this
release gate does not resolve the observed answer-screen transition.
