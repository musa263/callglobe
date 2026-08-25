# Vocivo Voice Engine

Self-hosted text-to-speech for company prompts using the Apache-2.0 licensed Kokoro-82M model. It provides two male and two female English voices, authenticated rendering, and stable HTTPS audio URLs for SIP playback.

## Run

```bash
docker build -t vocivo-tts .
docker run --restart unless-stopped -p 8000:8000 \
  -e PUBLIC_BASE_URL=https://voice.example.com \
  -e TTS_SERVICE_SECRET=replace-with-a-long-secret \
  -v vocivo-tts-cache:/var/cache/vocivo-tts \
  vocivo-tts
```

Terminate TLS in a reverse proxy and set the same values as `TTS_SERVICE_URL` and `TTS_SERVICE_SECRET` in Vercel. The first request downloads the Kokoro model and is slower; warm the four voices before production traffic.

The service is for prompt generation. Interactive conversational AI still needs an ASR/LLM dialog service and uses the configured carrier fallback until that media service is deployed.
