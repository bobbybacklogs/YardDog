---
name: verify-yarddog
description: >-
  Verify YardDog crew/directives and hosted vs local adapter claims without a
  live AI Gateway key by default (typecheck, bun test, scripted hosted
  directive smoke). Use after harness, client, or hosted changes, or when
  re-grading docs/FEATURE_MAP.md.
---

# Verify YardDog

Default proof is **offline**. Do not require `AI_GATEWAY_API_KEY` unless the
change is specifically the live Gateway path.

Read [`docs/FEATURE_MAP.md`](../../../docs/FEATURE_MAP.md) first. Grades there
are the contract: **Proven / Code-inspected / Unverified / Gap**. Do not hide a
Gap by adding product behavior so verify passes.

## Default path (no key)

From repo root:

```bash
bun install
npm --prefix hosted install
bun run verify
```

`verify` is:

1. `bun run typecheck` — `tsc --noEmit` on `src/`
2. `bun test` — unit / harness / client / model tests (no live Gateway)
3. `bun run hosted:directives` — `hosted/scripts/smoke-directives.ts` with a
   **scripted** `runModelTurn` (no Eve TUI, no API key)

Expect `hosted:directives` to print `@foreman` then `@mule` and JSON
`{ "ok": true, "live": false, "via": "scripted", "modelHitch": false }`.

`tests/tui-smoke.test.ts` may set a dummy `AI_GATEWAY_API_KEY=test-key` so the
TUI process starts. That is not a live Gateway turn.

### What this proves

- Typecheck of the Bun/CLI tree
- Parser + **HostedYardDog** directive loop (delegate / consult / escalate)
- Client mode resolution and mock Eve HTTP
- Local tools / computer / MCP fixture / hall mapping / skills staging
- Scripted hosted directive smoke

### What this does not prove

- Live AI Gateway (`hosted:smoke`, `smoke-directives --live`, real `ask`)
- Live Eve host (`cd hosted && npm run dev` + `YARDDOG_EVE_URL=… ask`)
- Live Cursor Cloud `@delegate` (`CURSOR_API_KEY`)
- Local `YardDog` directive execution (code-inspected only — see feature map)
- Eve TUI crew presence, hire/MCP/skills on Eve (documented Gaps)

## Live Gateway (optional, env-gated)

Only when the user asked for a live turn **and** a key is present:

```bash
# fails closed if the key is missing
VERIFY_LIVE=1 bun run verify
```

Or directly:

```bash
# one adapter turn
bun run hosted:smoke -- "Say hello from the yard"

# hosted crew with real models
npm --prefix hosted run smoke-directives -- --live "Have mule draft a one-line README blurb"
```

Requires `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Do not invent a key.
If unset, skip and leave the claim **Unverified**.

Live Eve client (also unverified by default):

```bash
# terminal A
cd hosted && npm run dev

# terminal B
YARDDOG_EVE_URL=http://127.0.0.1:2000 bun run src/cli.ts status
YARDDOG_EVE_URL=http://127.0.0.1:2000 bun run src/cli.ts ask "…"
```

## Rules

- Smallest truthful run. Do not change product code to make verify green.
- Prefer `hosted:directives` over `hosted:smoke` unless the change is the
  Gateway adapter or a live turn.
- After verify, update `docs/FEATURE_MAP.md` grades only when new evidence
  exists. New Gaps stay Gaps.
- Root `typecheck` does not include `hosted/`. Hosted `npm run typecheck`
  needs Node 24+ (Eve). This environment may only have Node 22 — treat hosted
  tsc as extra, not default.
- Bun ≥ 1.2 is required for `bun test` / `bun run typecheck`.
