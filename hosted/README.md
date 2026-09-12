# YardDog hosted (Eve)

Eve-hosted YardDog runtime — **preferred deploy plane** (Phase 1 scaffold).

## What this is

| Piece | Role |
| --- | --- |
| `agent/` | Eve agent (instructions, tools, future crew subagents) |
| `agent/tools/yarddog_gateway_turn.ts` | One turn via YardDog-owned `AiSdkAdapter` + lanes (AI Gateway) |
| `../src/model/` | YardDog-owned AI SDK adapter / lanes (not ModelHitch, not a GW shared package) |

ModelHitch is **not** on this happy path.

## Prerequisites

- **Node.js 24+** (Eve requirement)
- Vercel AI Gateway auth: `AI_GATEWAY_API_KEY` **or** linked project OIDC (`vercel link` + `vercel env pull`)

```bash
# from repo root
cp hosted/.env.example hosted/.env.local
# edit hosted/.env.local and set AI_GATEWAY_API_KEY=…
```

## Install & run

```bash
cd hosted
npm install
npm run dev          # Eve interactive session (Gateway model on defineAgent)
```

In the Eve session, ask anything — or ask the agent to call `yarddog_gateway_turn` for an explicit YardDog adapter turn.

### Smoke one adapter turn (no Eve TUI)

```bash
cd hosted
npm run smoke-turn -- "Say hello from the yard"
```

## Env

| Variable | Purpose |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (preferred for local) |
| `VERCEL_OIDC_TOKEN` | Alternative when linked to a Vercel project |
| `YARDDOG_FAST_POOL` / `YARDDOG_HIGH_POOL` | Optional comma-separated Gateway model ids |
| `YARDDOG_FAST_MODEL` / `YARDDOG_HIGH_MODEL` | Optional preferred model per lane |

## Out of scope (later phases)

- Full crew / `@delegate` / `@consult` / `@escalate` on Eve
- Cursor Cloud `@delegate` tool
- Removing ModelHitch from the Bun CLI harness
