# Vocivo Voice Engine

Self-hosted text-to-speech for company prompts and the receptionist, using the Apache-2.0 licensed Kokoro-82M model. It offers the 37 Kokoro voices the admin lists as `Vocivo.Kokoro.<Name>` (American and British English, Spanish, French, Italian, Brazilian Portuguese), authenticated rendering, and stable HTTPS audio URLs for SIP playback.

## Run

```bash
docker build -t vocivo-tts .
docker run --restart unless-stopped -p 8000:8000 \
  -e PUBLIC_BASE_URL=https://voice.example.com \
  -e TTS_SERVICE_SECRET=replace-with-a-long-secret \
  -v vocivo-tts-cache:/var/cache/vocivo-tts \
  vocivo-tts
```

Terminate TLS in a reverse proxy and set the same values as `TTS_SERVICE_URL` and `TTS_SERVICE_SECRET` in Vercel. In production `ops-sip-edge.yml` → `tts-deploy` does all of this on the SIP edge.

## How it stays fast

- The model and the two default voices are baked into the image, and the English pipeline is loaded when the process starts; `/health` reports `"ready": true` once a first sentence has been rendered. Nothing is downloaded during a call.
- Every rendered prompt is content-addressed (`voice|speed|text`) and kept for `TTS_CACHE_TTL_DAYS` (30). `/v1/audio/speech`, `/v1/audio/render` and `/v1/audio/prerender` all read and write the same cache, so a greeting rendered once for the receptionist is the same file the dialplan plays.
- `/v1/audio/prerender` queues a batch to be rendered in the background and answers 202 at once. The API calls it whenever a tenant saves a greeting, menu, voice or receptionist, so the next caller never waits for a cold render.
- Synthesis is serialised (Kokoro on a 1.5-CPU slice of the SIP edge), and several requests for the same unseen prompt produce one render.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | `ready`, loaded languages, pre-render queue depth |
| GET | `/v1/voices` | the voice table |
| POST | `/v1/audio/speech` | `{input, voice, speed?}` → WAV bytes (24 kHz, 16-bit) |
| POST | `/v1/audio/render` | same body → `{id, audio_url, cached}` for `http_cache://` playback |
| POST | `/v1/audio/prerender` | `{items:[{input, voice}]}` → 202 `{queued, cached}` |
| GET | `/v1/audio/{id}.wav` | the rendered file, immutable |

All but the last require `Authorization: Bearer $TTS_SERVICE_SECRET`.

## Tests

`python3 -m unittest discover -s tests` runs against a stub pipeline when Kokoro is not installed, so the HTTP contract and the cache can be checked anywhere.


Pre-render admission is capped at 256 queued prompts. When full, optional warmup
items are skipped and live requests still render on demand. The `queued` count
reports admitted items. A fixed table of 512 striped locks preserves single
render ownership even during cache churn; hash collisions serialize work.
The service tests use a stub voice, not perceptual or MOS validation.


The engine rejects empty, all-zero and non-finite generated waveforms. Cache
hits require a complete 24 kHz mono PCM16 WAV. Startup always performs inference,
even if the warmup sentence already exists on the persistent volume. These
checks prevent known invalid assets; they do not provide MOS or language grading.
Malformed Unicode bearer values return unauthorized rather than an internal error.
