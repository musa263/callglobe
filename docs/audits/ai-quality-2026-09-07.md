# AI quality audit — 2026-09-07

Local code audit and repairs; no production deployment or paid calls. This is
not a claim that every AI defect has been found or that production audio quality
has passed acceptance. Existing concurrent SIP/telecom changes were preserved.

## Scope and evidence

Reviewed the self-hosted receptionist call loop, ESL, interruption detector,
Whisper integration, Claude streaming, Kokoro HTTP/cache service, receptionist
profile/voice catalog, opening-hours description, transcript ingestion, and
managed AI transfer/reply entry points. Read the supplied mock harness and the
repository engineering requirements. Versions come from service manifests:
Python 3.11 container, faster-whisper 1.1.1, httpx 0.28.1, Kokoro 0.9.4,
FastAPI 0.116.1 and Uvicorn 0.35.0. The deployed voice edge was not established.

## Repairs

| Defect | Changed behavior and regression evidence |
| --- | --- |
| Real names and short caller replies discarded as hallucinations | `speech.py::drop_hallucinated_transcript` now preserves names, substrings, thanks and goodbyes. Only exact long greeting echoes and distinctive caption fillers are rejected. `test_ai_quality.py` covers these cases. |
| Streaming delayed playback until model completion | `call.py::_think` now plays text openings while generation continues, then skips that prefix during remaining playback while retaining the full transcript. An event-controlled test proves playback precedes model completion and is not repeated. Tool speech waits for decision validation. |
| Stream errors and abrupt EOF accepted as replies | `brain.py::_collect_stream` rejects explicit error events, missing `message_stop`, malformed tool JSON, and non-object tool arguments. Provider recovery handles these failures. |
| Per-read HTTP timeout allowed an indefinitely trickling model stream | Model request and collection share a 20-second total deadline. External cancellation still propagates. |
| Repeated provider outage produced an apology loop | Failure count is per conversation. One transient failure can recover; a second uses the authorized open-office fallback. With no fallback, deterministic message mode saves subsequent caller text without invoking the unavailable model. |
| Long conversations sent unlimited model context | Provider context is capped at 40 recent turns, 24,000 characters total, 6,000 per turn. Stored transcript remains separate. The prompt instructs the model to ask about missing facts. This is truncation, not semantic summarization. |
| Stale transfer targets overrode a closed-office flag | Tool availability, prompt and decision validation all enforce `office_open`, with a stale-target denial test. |
| Silent TTS failures skipped required speech | Synthesis failure now reaches call recovery, which uses an allowed fallback or releases the call. It cannot silently advance past missing speech. |
| Persistent ASR failure asked the caller to repeat forever | Three consecutive failures transfer to the configured allowed fallback or release with an error if none exists. Whole-call socket coverage verifies transfer. |
| Idle release only checked after a silent listening turn | A per-call watchdog interrupts stalled work. Caller audio/words reset it; assistant playback does not. Environment settings are clamped to 1–90 seconds. Timer rescheduling, external cancellation and whole-call release have regression coverage. |
| Cancellation could accumulate native ASR work and race recording deletion | One native inference slot is retained until the worker really exits. Slot acquisition is bounded at 5 seconds, caller wait at 20 seconds, and the worker owns audio bytes. A blocked-thread test confirms cancellation does not release the slot early. |
| Record command failure leaked temporary caller audio | Partial recordings are discarded on command exceptions/cancellation. Regression verifies removal. |
| First-sentence latency label measured a later stage | The timestamp is captured in the streaming callback and labeled relative to model start. It is explicitly not measured first-word latency. |
| Trace logs exposed ordinary caller text/numbers | Removed direct transcript/number logs and provider error bodies; HTTP client INFO logs are suppressed in receptionist startup because query strings contain caller identity. This does not retroactively remove historic logs. |
| TTS lock eviction could create two locks for the same active prompt | Stable 512-way striped locks replace lock eviction; the regression obtains a lock, churns other keys, and checks identity. |
| Optional TTS prewarming had an unlimited queue | Admission is capped at 256 pending prompts; overflow is skipped and live rendering remains available. Queue and pending-key behavior are tested. |
| Idle outcome was stored as an error | `caller_went_quiet` is now accepted by the TypeScript conversation contract. |
| Saved prewarming used obsolete phrases | TypeScript canned/filler phrases now match the actual Python runtime strings. |
| Opening-hours text falsely included open days in a closed range | Nonconsecutive closed days are listed individually. A Monday/Wednesday/Friday regression covers the error. |

The phrase pre-render task is cancelled/awaited at normal call cleanup, and the
no-receptionist path closes its socket. README contracts were updated.

## Validation

- `bash verify.sh`: passed API typecheck, backend/frontend tests, web build,
  mobile typecheck and mobile tests.
- Python receptionist: **74 tests passed**, including simulated FreeSWITCH
  sockets, interruption, idle cancellation and new quality regressions.
- Python TTS: **8 tests passed**, using the repository Kokoro stub.
- `git diff --check`: passed.
- Python service tests ran with Python 3.12 in a temporary virtual environment;
  the production image's Python 3.11 was not executed. HTTP/audio dependencies
  used the service's pinned versions. The virtual environment is outside the repo.
- No real Whisper/Kokoro inference, ESL daemon, phone/carrier audio, Anthropic
  requests, production trace, container capacity test or production rollout.

## Remaining defects and acceptance gaps

1. **Voice quality is not measured MOS.** `voice-catalog.ts` contains static
   grades. `spokenVoice` has no qualifying B- fallback for Spanish, Italian or
   Portuguese. Arabic is offered to the conversation model but has no corresponding
   voice in the local catalog. There is no configured premium quality-fallback
   provider. Per-language voice acceptance and a fallback product/provider contract
   are still needed; assigning a synthetic MOS number would conceal this gap.
2. **Barge-in is an energy gate, not acoustic echo cancellation.** It cannot
   distinguish all background noise or handset echo from caller speech. Validate
   double talk, quiet callers, noisy handsets, one-word answers and lost media on
   real devices before claiming interruption timing or exclusive caller capture.
3. **Exact 90-second physical release is not proven.** The watchdog fires at the
   configured deadline after the greeting and interrupts pending work. Existing
   interruption cleanup may consume up to five seconds; the idle handler budgets
   two seconds for playback break, three for farewell and three for hangup.
   A strict wall-clock release at 90 seconds requires switch-side enforcement and
   a decision about farewell timing. Native inference is not forcibly killable.
4. **End-to-end first-word p50/p95 is not available.** Stage timings alone omit
   endpoint detection, queueing, playback startup and network/media delivery.
   Collect synchronized real-call traces and waveform evidence against the supplied
   two-second target before tuning CPU allocations or thread counts. First-sentence
   playback is improved, but this is WAV/file playback, not continuous PCM/RTP
   clause streaming with a zero-gap guarantee.
5. **Receptionist prompt-cache retention remains incomplete.** `Voice.say` keeps
   its separate local prompt cache without the TTS service's TTL/size sweep.
   Dynamic replies can contain private data. The TTS public audio URLs are
   deterministic content hashes, not tenant authorization. A retention/access
   migration needs to preserve FreeSWITCH playback URLs and active audio files.
6. **Service shutdown does not drain active calls.** `main.py::serve` stops the
   listener then closes shared clients without tracking in-flight handlers. Setup
   errors before the conversation's try/finally also have incomplete call-level
   recovery. Exercise SIGTERM and configuration-service failures before rolling
   out under live traffic.
7. **Managed AI transfer recovery remains incomplete.** In
   `routes/voice-ai-transfer.ts`, failures after stopping the assistant stop
   ringback but do not restore a speaking assistant or invoke a tenant fallback.
   This path also needs a current `pbx.ai.transferEnabled` check after token
   validation. These carrier-flow changes require their own mocked lifecycle
   regressions and real managed-edge acceptance; they were not changed here.
8. **Context truncation can forget earlier details.** The request is bounded,
   but no validated summary/fact extraction preserves earlier names and requests.
   Test long business conversations; the model must ask again rather than infer.
9. **Health/readiness is not capacity evidence.** Real multilingual model packs,
   startup time, CPU throttling, memory, queue delay and concurrent call limits
   remain unmeasured. No container allocations or dependency versions were changed.

## Assessment of the supplied harness

The harness uses sleeps and printed ESL commands rather than real ASR, LLM or
TTS. Its elapsed playback-command duration cannot measure audible first-word
latency or establish CPU contention. It resets an idle timer on assistant output,
uses wall-clock time, and combines farewell/hangup in one exception path, so a
failed farewell can skip hangup. Its placeholder TTS URI and fallback destination
are not the tenant-aware repository contracts. It was used as a requirements
reference, not installed as production code.

Primary protocol references checked during the fixes:
[Anthropic streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming)
and [faster-whisper 1.1.1 input contracts](https://github.com/SYSTRAN/faster-whisper/blob/v1.1.1/faster_whisper/transcribe.py).
