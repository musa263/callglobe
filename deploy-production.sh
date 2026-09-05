#!/usr/bin/env bash
set -Eeuo pipefail

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
frontend_dir="$root_dir/frontend"
mobile_dir="$root_dir/mobile"
deploy_branch=${DEPLOY_BRANCH:-main}
deploy_environment=${DEPLOY_ENVIRONMENT:-production}
run_mobile_checks=${RUN_MOBILE_CHECKS:-true}

fail() {
  printf 'Production deployment blocked: %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail 'git is required.'
command -v npm >/dev/null 2>&1 || fail 'npm is required.'
[ -f "$frontend_dir/package-lock.json" ] || fail 'frontend/package-lock.json is missing.'
[ -f "$root_dir/.vercel/project.json" ] || fail 'The repository is not linked to the Vocivo Vercel project.'

current_branch=$(git -C "$root_dir" branch --show-current)
[ "$current_branch" = "$deploy_branch" ] || fail "Expected branch $deploy_branch, found $current_branch."
[ -z "$(git -C "$root_dir" status --short --untracked-files=no)" ] \
  || fail 'Tracked files are modified. Commit the release before deployment.'

printf 'Installing locked frontend dependencies...\n'
npm --prefix "$frontend_dir" ci
npm --prefix "$frontend_dir" run check:api
npm --prefix "$frontend_dir" test
npm --prefix "$frontend_dir" run build

if [ "$run_mobile_checks" = true ]; then
  printf 'Validating the mobile clients...\n'
  npm --prefix "$mobile_dir" ci
  npm --prefix "$mobile_dir" run typecheck
  npm --prefix "$mobile_dir" test
fi

if [ "${DRY_RUN:-false}" = true ]; then
  printf 'Dry run complete at commit %s.\n' "$(git -C "$root_dir" rev-parse --short HEAD)"
  exit 0
fi

printf 'Deploying the Node.js API and web client to Vercel %s...\n' "$deploy_environment"
# Vercel's saved Root Directory is frontend, relative to this repository.
vercel_args=(deploy --yes --cwd "$root_dir")
if [ "$deploy_environment" = production ]; then
  vercel_args+=(--prod)
fi
if [ -n "${VERCEL_TOKEN:-}" ]; then
  vercel_args+=(--token "$VERCEL_TOKEN")
fi

deployment_url=$(npx --yes vercel "${vercel_args[@]}" | tail -n 1)
case "$deployment_url" in
  https://*) ;;
  *) fail 'Vercel did not return a deployment URL.' ;;
esac

health_url="${VOCIVO_HEALTH_URL:-${deployment_url%/}/api/health}"
for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent --show-error --max-time 10 "$health_url"; then
    printf '\nVocivo production deployment is healthy.\nCommit: %s\nURL: %s\n' \
      "$(git -C "$root_dir" rev-parse --short HEAD)" "$deployment_url"
    exit 0
  fi
  [ "$attempt" -lt 6 ] || break
  sleep $((attempt * 5))
done

fail "The deployment completed, but $health_url did not become healthy."
