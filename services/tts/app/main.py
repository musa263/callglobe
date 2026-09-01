from __future__ import annotations

import hashlib
import hmac
import io
import os
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, Response
from kokoro import KPipeline
from pydantic import BaseModel, Field

app = FastAPI(title="Vocivo Voice Engine", version="1.0.0")
cache_dir = Path(os.getenv("TTS_CACHE_DIR", "/var/cache/vocivo-tts"))
cache_dir.mkdir(parents=True, exist_ok=True)
public_base_url = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
cache_ttl_seconds = max(1, int(os.getenv("TTS_CACHE_TTL_DAYS", "30"))) * 86400
service_secret = os.getenv("TTS_SERVICE_SECRET", "")
pipelines: dict[str, KPipeline] = {}

voices = {
    "af_heart": {"name": "Amina", "gender": "female", "language": "English", "lang_code": "a"},
    "af_bella": {"name": "Bella", "gender": "female", "language": "English", "lang_code": "a"},
    "am_adam": {"name": "Adam", "gender": "male", "language": "English", "lang_code": "a"},
    "am_michael": {"name": "Michael", "gender": "male", "language": "English", "lang_code": "a"},
}


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=2000)
    voice: str = "af_heart"
    speed: float = Field(default=1.0, ge=0.7, le=1.3)
    format: str = "wav"


def authorize(authorization: str | None = Header(default=None)) -> None:
    # Fail closed: an unset TTS_SERVICE_SECRET must never mean an open service.
    if not service_secret:
        raise HTTPException(status_code=503, detail="TTS_SERVICE_SECRET is not configured")
    expected = f"Bearer {service_secret}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def pipeline_for(lang_code: str) -> KPipeline:
    if lang_code not in pipelines:
        pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return pipelines[lang_code]


def synthesize(request: SpeechRequest) -> bytes:
    voice = voices.get(request.voice)
    if not voice:
        raise HTTPException(status_code=400, detail="Unknown voice")
    chunks = [audio for _, _, audio in pipeline_for(voice["lang_code"])(request.input, voice=request.voice, speed=request.speed)]
    if not chunks:
        raise HTTPException(status_code=500, detail="Voice engine returned no audio")
    buffer = io.BytesIO()
    sf.write(buffer, np.concatenate(chunks), 24000, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def evict_stale_cache_entries() -> None:
    # Opportunistic sweep so the content-addressed cache cannot grow unbounded.
    cutoff = time.time() - cache_ttl_seconds
    try:
        for entry in cache_dir.iterdir():
            if entry.suffix == ".wav" and entry.is_file() and entry.stat().st_mtime < cutoff:
                entry.unlink(missing_ok=True)
    except OSError:
        pass  # eviction is best-effort; synthesis must never fail because of it


def cache_key(request: SpeechRequest) -> str:
    return hashlib.sha256(f"{request.voice}|{request.speed}|{request.input}".encode()).hexdigest()


@app.get("/health")
def health(_: None = Depends(authorize)) -> dict:
    return {"status": "healthy", "engine": "Kokoro-82M", "license": "Apache-2.0"}


@app.get("/v1/voices")
def list_voices(_: None = Depends(authorize)) -> dict:
    return {"voices": [{"id": key, **value} for key, value in voices.items()]}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest, _: None = Depends(authorize)) -> Response:
    return Response(synthesize(request), media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})


@app.post("/v1/audio/render")
def render(request: SpeechRequest, _: None = Depends(authorize)) -> dict:
    if not public_base_url.startswith("https://"):
        raise HTTPException(status_code=503, detail="PUBLIC_BASE_URL must be configured with HTTPS")
    evict_stale_cache_entries()
    key = cache_key(request)
    path = cache_dir / f"{key}.wav"
    if not path.exists():
        audio_bytes = synthesize(request)
        temp_path = path.with_name(f".{key}.{os.urandom(4).hex()}.tmp")
        temp_path.write_bytes(audio_bytes)
        os.replace(temp_path, path)  # atomic publish: readers never see a partial file
    return {"id": key, "audio_url": f"{public_base_url}/v1/audio/{key}.wav", "cached": True}


@app.get("/v1/audio/{audio_id}.wav")
def audio(audio_id: str) -> FileResponse:
    if len(audio_id) != 64 or any(character not in "0123456789abcdef" for character in audio_id):
        raise HTTPException(status_code=404, detail="Audio not found")
    path = cache_dir / f"{audio_id}.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=31536000, immutable"})
