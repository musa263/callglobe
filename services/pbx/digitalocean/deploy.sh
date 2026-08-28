#!/bin/sh
set -eu

: "${PBX_HOST:?Set PBX_HOST to the DigitalOcean Reserved IP or DNS name.}"
PBX_USER=${PBX_USER:-root}
PBX_PATH=${PBX_PATH:-/opt/vocivo-pbx}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if [ ! -f "$source_dir/.env" ]; then
  echo "Create services/pbx/.env from .env.example before deployment." >&2
  exit 1
fi

rsync -az --delete \
  --exclude '.env' \
  --exclude 'secrets/' \
  "$source_dir/" "$PBX_USER@$PBX_HOST:$PBX_PATH/"
scp "$source_dir/.env" "$PBX_USER@$PBX_HOST:$PBX_PATH/.env"
if [ -d "$source_dir/secrets" ]; then
  ssh "$PBX_USER@$PBX_HOST" "mkdir -p '$PBX_PATH/secrets' && chmod 700 '$PBX_PATH/secrets'"
  # The host directory remains owner-only. Files are readable in the mounted
  # container so the non-root Node process can load APNs/FCM credentials.
  rsync -az --chmod=F644 "$source_dir/secrets/" "$PBX_USER@$PBX_HOST:$PBX_PATH/secrets/"
fi
ssh "$PBX_USER@$PBX_HOST" "chmod 600 '$PBX_PATH/.env' && cd '$PBX_PATH' && docker compose config --quiet && docker compose up -d --build && docker compose up -d --force-recreate caddy && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile && docker compose ps"
