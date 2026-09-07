# Stage 1 call retest — September 7, 12:26 UTC

Result: failed. Identity adoption remains deployed, but calling acceptance is
not complete. No code, carrier settings, or mobile build changed during this test.

## Build and test conditions

- Production commit: `305aa0ca5ca42f890cdcdf9938cd949f0bbb78cf`.
- Deployment: `dpl_3XFrYaMG4xHpyK1mAio2kGFff6d3`, confirmed Ready at vocivo.app.
- Caller: signed-in web phone, extension 2000. Recipient: extension 2003 on the
  iPhone; user confirmed Vocivo open and unlocked before the test. The previously
  inspected installed build was 60; its source revision remains unverified.
- Free internal route, no PSTN call. Prior signed-in release verification confirmed
  `extension_authority: vocivo` and `voice_edge: sip`.

## Observed result

Call `7rrg08bpeot7gbj28ukj`, route `vc_mtr7sil4_a3dl1uu1`:

| Event | UTC |
| --- | --- |
| Stored initiation | 12:26:23 |
| Stored answer | 12:26:45 |
| Answer ACK at edge | 12:26:45.554 |
| BYE at edge | 12:26:54.991 |
| Stored hangup | 12:26:54, NORMAL_CLEARING |

The user reported delayed ringing and connection, then explicitly confirmed the
call disconnected on its own. Setup-to-answer was approximately 22 seconds and
the recorded connected duration was nine seconds. NORMAL_CLEARING describes the
SIP ending; it does not establish an intentional user hangup. Browser snapshots
missed the brief active period, so their initial apparent lack of connection is
superseded by the ACK and persisted answered event. Two-way audio was not confirmed.

## Correlated evidence

- [Compact SIP trace](https://github.com/musa263/vocivo/actions/runs/34121986833).
- [Detailed registration log](https://github.com/musa263/vocivo/actions/runs/34122667901).
- Extension 2003 received multiple password-mismatch rejections during setup,
  including 12:26:32.328, 12:26:33.637, 12:26:37.765 and 12:26:38.994.
- The detailed log resolves the compact trace's empty authentication responses:
  Kamailio's HTTP client repeatedly timed out on the local `/sip-auth` proxy.
  Requests at 12:26:45.666 and 12:26:46.017 timed out at 12:26:49.670 and
  12:26:50.020. Subsequent requests at 12:26:50.503 and 12:26:50.546 timed out
  at 12:26:54.505 and 12:26:54.550. This is a measured roughly four-second
  request deadline, not merely an empty JSON parsing symptom.
- The BYE came from a different WebSocket connection than the caller's answer
  ACK and targeted the caller's dialog contact. This supports receiver-side
  termination, approximately half a second after the last authentication timeout.
- API request logs in the sampled window contain successful and rejected auth
  requests and several successful credential issuances, with no sampled 5xx.
  Successful server completion does not prove the edge received a response before
  its deadline. The 200-line CLI sample represented 50 unique request IDs; repeated
  JSON lines must not be counted as separate requests. The CLI output does not
  provide request duration or safe device ownership correlation.
- The browser also retained overlapping REGISTER and authentication warnings.

## Interpretation and remaining gates

Authentication latency and repeated credential recovery are confirmed problems.
The timeouts immediately preceding the receiver's BYE are strong correlation;
without native call-state logs, the exact code path requesting hangup is not yet
proven. Stage 1 adoption itself preserved SIP usernames and did not rotate device
passwords. Do not attribute every password rejection to that migration, disable
replay checks, or treat a longer ringing timeout as a fix.

Next work must identify the slow auth operations and correct timeout/recovery
handling, including preserving a valid active SIP dialog during a recoverable
registration failure. Capture a source-matched mobile trace for the unexpected
hangup. After validated fixes are deployed to the appropriate API/edge/mobile
layers, repeat foreground, locked and app-closed calls with explicit two-way
audio and hangup confirmation. Locked/app-closed retests were not performed after
this failure. Android, carrier audio and the other live administration/revocation
gates remain unverified.

## Corrective changes

The API now performs one tenant-state read for REGISTER and skips SaaS
bootstrap/schema work on this path. Persisted tenant/plan data is required;
identity, admin ownership, forced password change, fresh revocation, entitlement,
and replay checks remain enforced. Auth requests lasting 1500 ms log sanitized
phase timings for further latency diagnosis.

The edge now requires expected HTTP status and JSON decisions. libcurl timeout
28, 5xx, empty and malformed responses return 503 without a new password challenge.
The pinned parser and 14 isolated auth exchanges passed in GitHub Actions run
34124720623, alongside ingress and delayed-delivery regression checks.

Mobile Unregistered events provisionally enter recovery because SIP.js emits
these before the rejection delegate. 408/429/5xx remain recoverable; final
401/403 still report refusal. The provider preserves media within its 45-second
grace period and repeated failures no longer extend that deadline. Successful
registration clears the deadline. Tests cover state/callback order and a mounted
provider preserving, recovering, then disposing an established call on expiry.

Local validation: 411 backend/web, 139 mobile unit, 54 mobile integration tests
passed (604 total), API/mobile typechecks and web build passed. Additional auth
timing instrumentation passed API typecheck and handler regressions. These are
software regressions, not physical-device acceptance. An iPhone build and live
unlocked/locked/terminated-state calls remain required; Android is unavailable.

## Follow-up latency and native-build checks

Production timing instrumentation still found 4–7 second auth requests after the
first fix. Tenant data is now fetched by one query inside the same RLS-scoped
transaction, and the replay claim is an atomic conditional upsert. REGISTER skips
replay-table DDL; occasional expiry cleanup is retained for SIP-only deployments.
The edge HTTP deadline is ten seconds, below SIP transaction expiry.

A disposable PostgreSQL gate passed with a non-superuser and forced RLS:
missing-schema reads create no tables; concurrent tenant reads remain isolated;
missing subscriptions fail closed; exactly one of 20 concurrent replay claims
wins; expired claims can be reclaimed once. Runs 34127225501 (PostgreSQL),
34127225286 (SIP), and 34127225444 (quality) passed. Concurrent push-ownership
commit 2195b2e was preserved in merge 58b50ce before deployment.

Four bounded live API Digest probes passed for 2000 and 2003: 2879, 1794, 2421,
and 1658 ms, including network time from this Mac. Replays for both extensions
returned 403/replayed_digest. These probes did not register contacts or place
calls. They do not prove handset ringing, media, or call stability.

The iPhone build uncovered a React Native 0.81.5 static-header mapping failure;
the patch preserves its nativeviewconfig directory. A malformed statement in the
existing Telnyx compatibility patch was corrected before a clean npm install.
APNs environment is now read from the signing profile because a development-signed
Release build still receives sandbox tokens. Native profile tests and the updated
606-test app gate pass. Signed iOS/Android builds and physical acceptance remain
pending at this checkpoint.

## Native artifacts

Android debug APK compiled successfully (486 tasks) after clean dependency
installation. No Android device was available for audio or background acceptance.
iOS Release build 61 compiled and passed deep/strict code-signature verification.
The provisioning profile includes the test iPhone and has development APNs,
confirming the new profile-derived sandbox routing is needed for this build.
The final bundle SHA-256 is
`596c9ae11c9f2debaacf427e09e37d7b0e57917e6b9cae568de2755cb8a12388`.
The local `/tmp` versus `/private/tmp` Metro entry mismatch was resolved in the
ignored Xcode environment using the canonical entry-file path.

The additional internal-route wire gate passed in run 34129054266. Final server
source merge 3d297c7 preserves inbound diagnostics from concurrent commits
0c6f4b9/a4a4cae. Physical iPhone acceptance remains the next gate.

## Build 61 physical retest — 14:24–14:28 UTC

Build 61 was installed and its version verified with CoreDevice. Production
`vocivo.app` resolved to Ready deployment `dpl_7VbU5hKhaeN1sNGHWem8muiUCpHM`.

- Foreground call `d5mg8uo5ub1rj9ep7b24`, route `vc_mtrc0549_zbqf5qk4`:
  initiated 14:24:15, answered 14:24:32, deliberately ended from the browser
  at 14:26:10. The user confirmed two-way speech and normal handset UI closure.
  Connected duration was 98 seconds. Initiation-to-answer includes human delay
  and does not measure the first audible ring.
- Locked-screen call `d5mg8uccdi9miu60dqqi`, route `vc_mtrc3nne_jymre0tt`:
  initiated 14:26:59, answered 14:27:15, ended at 14:27:48. The user confirmed
  prompt ringing, lock-screen answer and two-way audio, but explicitly confirmed
  that the call disconnected by itself after 33 connected seconds.

Trace run 34133161983 shows browser-side ACK ingress at 14:27:15.681 and
14:27:16.436, followed by BYE ingress from the handset transport at
14:27:48.319. An ACK reaching Kamailio does not establish that it reached the
phone. The approximately 32-second interval is consistent with an ACK timeout,
but the exact native/transport cause is not yet proven. No timer or security
check has been disabled on this hypothesis.

Stage 1 physical acceptance remains FAILED. The terminated-state retest has not
been attempted on build 61. The next step is a private handset-console capture
and a bounded locked-screen reproduction; CoreDevice cannot launch logging
until the user unlocks the phone. Android physical acceptance remains unavailable.

## Additional build 61 calls and credential-renewal race

The logged retry `6rs7fe8qb3r8i7nv8m2g` (route `vc_mtrcnr02_pan3nj0g`)
answered at 14:42:49 and was deliberately ended at 14:46:13 UTC: 204 seconds.
The user confirmed two-way audio. Its successor `6rs7faffs5gackidt4j0`
(route `vc_mtrcyw98_526cetnb`) answered at 14:51:26 and ended at 14:52:05,
after 39 seconds; the user again confirmed an unexpected disconnect. Trace
34135463209 shows ACK ingress and handset-side BYE. Variable duration weakens
the initial fixed ACK-timeout hypothesis; ingress ACK alone remains insufficient.

A further call `6rs7fj1bd3nugebu3lkn` (route `vc_mtrdcrs8_w3fu4wm6`)
answered at 15:02:25 and was deliberately ended at 15:07:02: 277 seconds.
Browser signaling stayed established; the separate audio-confirmation question
was still unanswered when this record was written. The physical iPhone Console
stream showed SIP transport unavailable/internal 503 at 15:02:11, before answer.
Earlier Console observations came from a similarly named simulator and must
not be treated as physical-device evidence. Device selection was corrected to
`iPhone`, matching CoreDevice's verified name, before the final call.

A controlled bootstrap regression reproduced a distinct call-disposal race:
start a credential HTTP request while idle, accept an incoming call before the
response completes, then deliver the new password. The original code disposes
the live session and stops its engine. Checking call state only before the
HTTP request is insufficient.

The bridge now rejects engine replacement while ringing, active, or held calls
exist. The runtime updates authentication on the existing SIP.js user agent,
since the server has already replaced the device's old password, and retains
the full new configuration for application after calls end. It returns a short
retry lifetime. A rejection from an older in-flight password generation remains
recoverable; a rejection using the current generation retains normal denial
handling. Sign-out still disposes calls. Identity/transport changes are refused
by in-place password rotation.

The new race test failed before the fix and passed afterward. An installed
SIP.js test verifies old/new Digest responses and unchanged core/transport.
The full gate passed: 412 backend/web, 147 mobile unit, 55 mobile integration
(614 total), typechecks and web build. Release iPhone build 62 compiled and
passed deep/strict signature verification. This fixes a reproduced code defect;
it is not yet proof of the cause or resolution of every physical hangup.
Build 62 installation and repeat-call acceptance remain required.
