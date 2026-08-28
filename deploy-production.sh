#!/usr/bin/env bash
set -Eeuo pipefail

PBX_HOST=${PBX_HOST:-68.183.244.215}
PBX_USER=${PBX_USER:-root}
PBX_REPOSITORY=${PBX_REPOSITORY:-https://github.com/musa263/vocivo.git}
PBX_BRANCH=${PBX_BRANCH:-main}
PBX_REPO_PATH=${PBX_REPO_PATH:-/opt/vocivo}
PBX_LEGACY_PATH=${PBX_LEGACY_PATH:-/opt/vocivo-pbx}
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-420}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
local_pbx="$script_dir/services/pbx"

case "$PBX_HOST" in ''|*[!A-Za-z0-9.:-]*) echo "Invalid PBX_HOST" >&2; exit 2;; esac
case "$PBX_USER" in ''|*[!A-Za-z0-9._-]*) echo "Invalid PBX_USER" >&2; exit 2;; esac
case "$PBX_BRANCH" in ''|*[!A-Za-z0-9._/-]*) echo "Invalid PBX_BRANCH" >&2; exit 2;; esac
case "$PBX_REPO_PATH" in /*) ;; *) echo "PBX_REPO_PATH must be absolute" >&2; exit 2;; esac

target="$PBX_USER@$PBX_HOST"

if [ -n "$(git -C "$script_dir" status --short --untracked-files=no)" ]; then
  echo "Tracked local files are modified; commit them before production deployment." >&2
  exit 1
fi

"$local_pbx/digitalocean/validate-production-env.sh" "$local_pbx"

ssh -o BatchMode=yes "$target" bash -s -- \
  "$PBX_REPOSITORY" "$PBX_BRANCH" "$PBX_REPO_PATH" "$PBX_LEGACY_PATH" <<'REMOTE_PREPARE'
set -Eeuo pipefail

repository=$1
branch=$2
repo_path=$3
legacy_path=$4
pbx_path="$repo_path/services/pbx"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required" >&2; exit 1; }

if [ ! -d "$repo_path/.git" ]; then
  [ ! -e "$repo_path" ] || { echo "$repo_path exists but is not a Git checkout" >&2; exit 1; }
  git clone --branch "$branch" --single-branch "$repository" "$repo_path"
fi

cd "$repo_path"
[ -z "$(git status --short --untracked-files=no)" ] \
  || { echo "Tracked files on the droplet are modified; refusing to overwrite them" >&2; exit 1; }
git fetch --prune origin "$branch"
git checkout "$branch"
git pull --ff-only origin "$branch"

install -d -m 700 "$pbx_path/secrets"
if [ ! -f "$pbx_path/.env" ] && [ -f "$legacy_path/.env" ]; then
  install -m 600 "$legacy_path/.env" "$pbx_path/.env"
fi
if [ -d "$legacy_path/secrets" ]; then
  for source in "$legacy_path"/secrets/*; do
    [ -f "$source" ] || continue
    destination="$pbx_path/secrets/$(basename "$source")"
    [ -e "$destination" ] || install -m 600 "$source" "$destination"
  done
fi
REMOTE_PREPARE

scp -q "$local_pbx/.env" "$target:$PBX_REPO_PATH/services/pbx/.env"
scp -q \
  "$local_pbx/secrets/apns-auth-key.p8" \
  "$local_pbx/secrets/firebase-service-account.json" \
  "$local_pbx/secrets/turn-auth-secret" \
  "$target:$PBX_REPO_PATH/services/pbx/secrets/"

ssh -o BatchMode=yes "$target" bash -s -- \
  "$PBX_REPO_PATH" "$HEALTH_TIMEOUT_SECONDS" <<'REMOTE_DEPLOY'
set -Eeuo pipefail

repo_path=$1
health_timeout=$2
pbx_path="$repo_path/services/pbx"
chmod 600 "$pbx_path/.env" "$pbx_path"/secrets/*

diagnostics() {
  status=$?
  if [ -f "$pbx_path/docker-compose.yml" ]; then
    cd "$pbx_path"
    docker compose ps || true
    docker compose logs --since=10m --tail=120 || true
  fi
  exit "$status"
}
trap diagnostics ERR

"$pbx_path/digitalocean/validate-production-env.sh" "$pbx_path"

cd "$pbx_path"
docker compose config --quiet
docker compose build --pull
docker compose up -d --remove-orphans

deadline=$((SECONDS + health_timeout))
while :; do
  unhealthy=0
  pending=0
  for service in $(docker compose config --services); do
    container=$(docker compose ps -q "$service")
    [ -n "$container" ] || { unhealthy=1; continue; }
    state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
    case "$state" in
      'running healthy'|'running none') ;;
      'running starting') pending=1 ;;
      *) unhealthy=1 ;;
    esac
  done
  [ "$unhealthy" -eq 0 ] || { echo "A production container failed during startup" >&2; exit 1; }
  [ "$pending" -eq 0 ] && break
  [ "$SECONDS" -lt "$deadline" ] || { echo "Timed out waiting for healthy containers" >&2; exit 1; }
  sleep 5
done

docker compose exec -T freeswitch /usr/local/freeswitch/bin/fs_cli \
  -H 127.0.0.1 -P 8021 -p "$(awk -F= '$1 == "ESL_PASSWORD" { print substr($0, index($0, "=") + 1) }' .env)" -x status
docker compose exec -T coturn turnutils_stunclient -p 3478 127.0.0.1
curl --fail --silent --show-error http://127.0.0.1:8088/healthz >/dev/null

docker compose ps
docker compose logs --since=5m --tail=80 freeswitch esl-listener coturn caddy edge-router
echo "Vocivo production PBX deployment completed from $(git rev-parse --short HEAD)."
REMOTE_DEPLOY
