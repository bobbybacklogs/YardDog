#!/usr/bin/env bash
# Default YardDog verify: typecheck + unit tests + no-key hosted directive smoke.
# Live AI Gateway is opt-in via VERIFY_LIVE=1 (needs AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v bun >/dev/null 2>&1; then
  echo "verify: bun is required (https://bun.sh)" >&2
  exit 127
fi

bun run typecheck
bun test

if [[ ! -d hosted/node_modules ]]; then
  echo "verify: installing hosted deps (no-key smoke needs tsx + hosted tree)"
  npm --prefix hosted install --no-fund --no-audit
fi

bun run hosted:directives

if [[ "${VERIFY_LIVE:-}" == "1" ]]; then
  if [[ -z "${AI_GATEWAY_API_KEY:-}" && -z "${VERCEL_OIDC_TOKEN:-}" ]]; then
    echo "verify: VERIFY_LIVE=1 but AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN is unset" >&2
    exit 2
  fi
  bun run hosted:smoke -- "Say hello from the yard"
fi
