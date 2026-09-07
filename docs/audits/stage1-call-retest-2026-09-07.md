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
