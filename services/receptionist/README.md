# Vocivo receptionist

The AI receptionist, running on Vocivo's own hardware.

Every part of a call is handled here except one. FreeSWITCH carries the audio,
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) hears what the
caller said, and the Kokoro service on the same droplet says the reply. Only
the language-model turn leaves the machine, as one HTTPS request carrying the
conversation. Nothing is sent to a carrier, nothing is billed per minute, and
the recordings and transcripts stay on infrastructure Vocivo controls.

## How a call runs

FreeSWITCH's dialplan hands the call over with `socket 127.0.0.1:8084 async
full`, which opens an Event Socket connection to this service — one connection
per call. From there:

1. Ask the Vocivo API which receptionist answers the number that was dialled.
   No receptionist means the call is released, not answered by a default agent
   that belongs to nobody.
2. Answer, and play the tenant's greeting.
3. Take turns. `record` with silence detection ends when the caller stops
   talking; the recording is transcribed, the conversation goes to the model,
   and the reply is synthesised and played.
4. Act on what the model decided: keep talking, transfer to an extension, take
   a message, or say goodbye — and stay on the line. The receptionist never
   hangs up on a caller; the caller ends the call.
5. File the transcript back to the API.

A transfer is a blind transfer back into the same dialplan, so the rules that
route an ordinary internal call decide where it lands — the receptionist can
never reach somewhere a colleague could not.

## The parts that matter

**Prompts are cached by content.** A receptionist says "Thanks, please hold"
thousands of times. Synthesising it once is the difference between a natural
pause and a second of dead air on every call.

**The caller's audio is not kept.** Each turn's recording is transcribed and
then deleted. The transcript is what the tenant sees.

**A hallucinated extension is refused.** The model may only transfer to
extensions on the tenant's own list, and only to ones somebody can actually
answer — an active extension with a SIP username. A caller told they are being
put through to nobody is worse than one told to leave a message.

**When the model cannot be reached, a person is.** The fallback is a transfer
to the tenant's fallback extension, or taking a message — never an apology
loop.

**Speech recognition runs in a worker thread.** It is CPU-bound and shares a
process with live calls; on the event loop it would stall them.

**The model streams, and the first sentence is spoken as soon as it is
written.** `Brain.respond` reads the reply as server-sent events and calls
`on_first_sentence` the moment the first sentence is complete;
`CallHandler._think` hands that sentence to the voice engine while the rest of
the answer is still arriving, so playback starts at once. A filler ("mm-hm, one
moment") is said only when nothing has begun to arrive after three seconds.

**Only the caller's side is recorded.** `RECORD_READ_ONLY=true` keeps our own
prompts (and their echo) out of the turn recording — the recogniser used to
hear the greeting back and answer it. `RECORD_MIN_SEC=0` keeps one-word answers
FreeSWITCH would otherwise delete. Turns cap at `listen_seconds` (12 s) and end
`silence_seconds` (2 s) after the caller stops; the silence threshold (450)
sits above a mobile caller's background noise.

**Hallucinated transcripts are dropped.** `drop_hallucinated_transcript`
discards a transcript that is only the greeting, the business name, a transfer
target's name or one of Whisper's silence fillers ("Thank you.").

**A transfer nobody answers comes back here.** `_transfer` sets
`vocivo_from_receptionist=1`; the API's dialplan returns the call with
`vocivo_transfer_failed=1`, and `handle` opens with `CANNED["transfer_unanswered"]`
— an offer to take a message — instead of the greeting.

**There is no turn budget, and the receptionist never hangs up.** A
conversation lasts as long as the caller needs; the model's `wrap_up` tool says
goodbye and leaves the line open for the caller to put down. Silence is met
with two gentle prompts and then patience. The one exception is a line nobody
has spoken on for `idle_hangup_seconds` (90 s) — a caller who walked away —
which is released with a goodbye so it does not sit open for an hour.

**Answers play without stops.** `_speak` sends every sentence to the voice
engine at once (two at a time) and, whenever the next sentence is already
rendered when the current one ends, hands both to FreeSWITCH as a single
`file_string://` playback — no round trip, no gap. Rendering one sentence
ahead and playing them one file at a time left a beat of silence between
every sentence.

**Every stage logs its time.** Per turn: how long the recorder ran (and whether
it hit its limit), loudness, recognition time, model time, when the first
sentence was ready, and synthesis time per sentence; per call: the outcome.
`Ops · Droplets → call-trace` prints these beside FreeSWITCH's hangup causes.

## Configuration

| Variable | Required | What it is |
| --- | --- | --- |
| `TTS_SERVICE_SECRET` | yes | Bearer for the Kokoro service |
| `LLM_API_KEY` | yes | The one external credential |
| `SIP_EDGE_SECRET` | yes | Shared with Kamailio, authenticates to the Vocivo API |
| `TTS_SERVICE_URL` | | Default `http://127.0.0.1:8000` — loopback on the SIP edge |
| `STT_MODEL` | | `base` fits beside a live SIP process; `small` is better and wants its own box |
| `LLM_MODEL` | | Default `claude-haiku-4-5` |
| `RECEPTIONIST_PORT` | | Default 8084 |
| `RECEPTIONIST_LISTEN_SECONDS` | | Longest single caller turn, default 20 |
| `RECEPTIONIST_SILENCE_SECONDS` | | Silence that ends a turn, default 2 |
| `RECEPTIONIST_MAX_TURNS` | | Default 12, so a stuck conversation cannot hold a line open |

The service refuses to start without the three required values, rather than
failing halfway through a stranger's call.

## Where it listens

`127.0.0.1:8084`, and that is the default rather than something the deployment
has to remember. The Event Socket has no authentication in outbound mode, so a
process that can reach this port can answer calls — and the SIP droplet has no
host firewall, so binding `0.0.0.0` would have put it on the public internet.
Both this service and FreeSWITCH run with host networking, so loopback is all
either of them needs.

## Tests

```
python3 -m unittest discover -s tests
```

They cover the Event Socket framing (including a hangup arriving in the middle
of another command, which must not be lost), the decision the model's response
maps to, and the guards around transfers.
