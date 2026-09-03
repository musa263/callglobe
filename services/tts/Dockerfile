FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TTS_CACHE_DIR=/var/cache/vocivo-tts
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# The model and the two voices every default prompt uses are baked into the
# image. Fetching them at run time meant the first caller after each restart
# waited ten to twenty seconds of silence for a download, and heard nothing
# at all when Hugging Face was slow.
RUN python - <<'EOF'
from kokoro import KPipeline
pipeline = KPipeline(lang_code="a")
for voice in ("af_heart", "am_adam"):
    for _ in pipeline("Thank you for calling.", voice=voice):
        pass
EOF
COPY app ./app
RUN mkdir -p /var/cache/vocivo-tts
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
