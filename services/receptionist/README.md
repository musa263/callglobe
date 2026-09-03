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
   a message, or say goodbye and hang up.
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

## Configuration

| Variable | Required | What it is |
| --- | --- | --- |
| `TTS_SERVICE_SECRET` | yes | Bearer for the Kokoro service |
| `LLM_API_KEY` | yes | The one external credential |
| `SIP_EDGE_SECRET` | yes | Shared with Kamailio, authenticates to the Vocivo API |
| `TTS_SERVICE_URL` | | Default `http://127.0.0.1:8000` — loopback on the SIP edge |
| `STT_MODEL` | | `base` fits beside a live SIP process; `small` is better and wants its own box |
| `LLM_MODEL` | | Default `claude-3-5-haiku-latest` |
| `RECEPTIONIST_PORT` | | Default 8084 |
| `RECEPTIONIST_LISTEN_SECONDS` | | Longest single caller turn, default 20 |
| `RECEPTIONIST_SILENCE_SECONDS` | | Silence that ends a turn, default 2 |
| `RECEPTIONIST_MAX_TURNS` | | Default 12, so a stuck conversation cannot hold a line open |

The service refuses to start without the three required values, rather than
failing halfway through a stranger's call.

## Where it listens

Loopback only. The Event Socket has no authentication in outbound mode, so
nothing outside the droplet should be able to reach port 8084 — the firewall
matters here as much as the code does.

## Tests

```
python3 -m unittest discover -s tests
```

They cover the Event Socket framing (including a hangup arriving in the middle
of another command, which must not be lost), the decision the model's response
maps to, and the guards around transfers.
