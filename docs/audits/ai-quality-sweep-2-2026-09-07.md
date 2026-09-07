# AI quality sweep 2 — 2026-09-07

Fresh local audit of the AI release deployed as `f4966ce`. Before these changes,
the workspace's receptionist, TTS and AI domain files matched that release.
Unrelated SIP/mobile work was preserved. This sweep's changes are local and have
not been committed or deployed. No finite audit establishes that all bugs are gone.

## Reproduced defects and repairs

| Area | Defect and repair | Regression evidence |
| --- | --- | --- |
| Model decisions | Refused transfers still spoke the model's success announcement. Only validated tool speech is now appended. | `test_sweep.py::test_refused_transfer_does_not_announce_success` |
| Model decisions | Multiple tools overwrote earlier actions, potentially confirming a message then discarding it for a transfer. Conflicting actions now ask for clarification without executing either. Empty messages cannot be confirmed as saved. | Conflicting-tools and empty-message tests |
| Model stream | Invalid indices, block/delta types and text fields escaped as Python exceptions; open tool blocks could survive `message_stop`. These are now protocol failures handled by normal model recovery. Malformed JSON is not silently skipped. | Malformed-stream and unclosed-tool tests |
| Receptionist audio | RIFF-prefixed junk and truncated cached WAVs could reach playback. Fresh and cached speech must have complete PCM16 frames. | Invalid-fresh-WAV test; existing cache regressions |
| TTS output/cache | Empty, all-zero or non-finite generated audio could be published; non-audio cache files were accepted by size alone. Reject those outputs and require a complete 24 kHz mono PCM16 cache file. | TTS `AudioValidation` tests |
| TTS readiness | A persistent warmup cache hit set readiness without exercising this process's voice inference. Warmup now always synthesizes once. | Cached-warmup regression |
| TTS authentication | A Unicode bearer value could make string `compare_digest` raise rather than reject access. Compare encoded values and return 401. | Unicode-auth regression |
| Call setup/cancellation | The call-level try/finally began after handshake and setup, allowing early failures to miss release/cleanup. An outer owner now releases on setup errors/cancellation and always closes the socket; prewarming begins after setup. | Setup-failure regression |
| ESL | Missing completion events returned `None`, indistinguishable from successful advancement, and acknowledgements had no deadline. Completion timeouts now raise; an acknowledgement timeout poisons/closes the connection so late replies cannot be reused. | Completion-timeout and missing-ack/reuse tests |
| ESL/capture recovery | Refused commands were always labeled caller hangup. Connected command failures now report errors; optional interruption capture rejection removes partial audio and falls back to sequential speech. | Capture-rejection test and existing interruption suite |
| Shutdown/startup | Shutdown closed shared clients while calls were active; failed warmup leaked clients. Track active handlers, stop admission, allow five seconds of grace, await cancellation cleanup, then close clients. | Shutdown-cleanup and warmup-failure tests |
| Finalization guard | The new setup owner must not release an already transferred call if transcript storage fails. Filing remains best effort, separately guarded. This regression protects the cleanup change in this sweep. | Transcript-failure-after-transfer test |
| Managed transfer authorization | A valid signed token ignored current disabled/replaced assistant settings; returned extension tenant ownership was not rechecked. Enforce current flags, assistant binding and tenant before carrier actions. | Real-handler permission and cross-tenant denial tests |
| Managed transfer input | Removing every nondigit silently turned malformed input such as `call1001` into extension `1001`. Require an exact 2–5 digit string. | Malformed-destination route test |
| Managed transfer recovery | Even a database failure before claim ownership attempted to stop caller playback. Pre-dial failure after stopping AI never resumed speech. Cleanup now requires claim ownership; a stopped assistant is restarted if dialing has not begun. | Lookup-failure and failed-ringback route tests |
| Managed transfer idempotency | Releasing the claim after an uncertain dial let retries attempt another destination despite a potentially existing leg. Keep the claim and leave playback untouched after dialing begins. | Uncertain-dial route test |
| Speech prewarming | API splitting separated titles such as `Dr.` and numbered boundaries that Python kept intact, causing cache misses. Align the boundary rules. | Title/number split regression |
| Self-hosted directory | Active entries with malformed extensions or whitespace SIP usernames were exposed as targets. Filter them out. | Directory validation regression |

The initial eight targeted Python tests failed on the pre-fix code (including
multiple malformed-event subcases). The repaired suite passes. These are functional
repairs; no dependency upgrade, model replacement, CPU quota change or fabricated
MOS scoring was introduced.

## Validation

- **87 receptionist tests passed** (74 existing plus 13 new), including simulated
  FreeSWITCH socket behavior, streaming, cancellation, inference ownership and
  failure recovery.
- **12 TTS tests passed** (8 existing plus 4 new). The stub now emits a finite tone
  so a silent-output rejection is meaningfully tested. This is not real Kokoro
  quality evidence.
- **8 new TypeScript regressions** cover managed transfer routes, self-hosted
  targets and prewarming. Total new tests in this sweep: **25**.
- `bash verify.sh` passed API typecheck, backend/web tests, web build, mobile
  typecheck and mobile tests. The current workspace includes unrelated ongoing
  changes, so this result describes the combined workspace, not a clean release
  candidate checkout.
- `git diff --check` passed. Python service validation used the temporary Python
  3.12 environment with pinned HTTP/audio dependencies, not a production rebuild.

## Production observation

A read-only [30-minute call-trace run](https://github.com/musa263/vocivo/actions/runs/34101227992)
completed successfully. Its small returned receptionist runtime excerpt contained
no ERROR/WARNING entries and no completed-call sample. This does **not** establish
successful conversations, audible playback, transfer completion, latency or capacity.
The trace workflow ran current main `2a46c0b`; no new code was shipped by that operation.
Caller content was not copied into this report.

## Remaining acceptance gates and risks

- Real ASR accuracy, MOS, multilingual voices, acoustic echo behavior, barge-in
  latency and first-word p50/p95 still need handset/carrier audio and representative
  concurrent load. Static catalog grades do not establish any of these.
- A carrier dial whose response is lost needs reconciliation with actual leg
  state. Keeping its claim avoids duplicate dialing but cannot establish whether
  the caller connected. The pre-dial recovery restarts the stored assistant;
  its behavior and available tools need managed-edge acceptance, including failure
  of the recovery API itself. It is not a guarantee of resumed conversation.
- The self-hosted receptionist's separate prompt cache remains without a TTL/size
  sweep. Public TTS asset URLs are bearer links based on content hashes. Tenant
  retention and asset-access migration remain unresolved.
- Exact physical release at 90 seconds is still unproven: cancellation, farewell,
  command acknowledgement and native inference have different lifetimes. Shutdown
  grace is followed by cleanup; `docker rm -f` in the deployment workflow bypasses
  graceful draining entirely.
- Conversation context truncation can forget earlier facts; there is no validated
  semantic summary. Transcripts filed after a return from a failed transfer also
  need segment-aware persistence review because the event id is call-scoped.
- TTS cache sweeping can race file serving; successful frame validation does not
  reserve the file until a later public download. A janitor/reader concurrency
  redesign and retention coverage remain necessary.
- Known startup/call failures are now bounded and tested, but this does not prove
  native inference termination, production Python 3.11 behavior, current carrier
  settings or physical device acceptance for this unshipped sweep.
