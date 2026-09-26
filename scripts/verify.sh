#!/usr/bin/env bash
# Default YardDog verify: typecheck + unit tests + no-key hosted directive smoke.
# Live AI Gateway is opt-in via VERIFY_LIVE=1 (needs AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN).
# Steps always all run; the exit code is the first failure (do not hide a red test).
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v bun >/dev/null 2>&1; then
  echo "verify: bun is required (https://bun.sh)" >&2
  exit 127
fi

fail=0
step() {
  local name="$1"
  shift
  echo "verify: >> $name"
  if "$@"; then
    echo "verify: ok  $name"
  else
    echo "verify: FAIL $name (exit $?)"
    fail=1
  fi
}

step typecheck bun run typecheck
step "bun test" bun test

if [[ ! -d hosted/node_modules ]]; then
  echo "verify: installing hosted deps (no-key smoke needs tsx + hosted tree)"
  npm --prefix hosted install --no-fund --no-audit
fi

step hosted:directives bun run hosted:directives

if [[ "${VERIFY_LIVE:-}" == "1" ]]; then
  if [[ -z "${AI_GATEWAY_API_KEY:-}" && -z "${VERCEL_OIDC_TOKEN:-}" ]]; then
    echo "verify: VERIFY_LIVE=1 but AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN is unset" >&2
    exit 2
  fi
  step hosted:smoke bun run hosted:smoke -- "Say hello from the yard"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "verify: done with failures (see FEATURE_MAP — do not patch product code to go green)"
  exit 1
fi
echo "verify: all default steps passed"
