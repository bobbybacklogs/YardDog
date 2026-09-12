# YardDog hosted (Eve)

Eve-hosted YardDog runtime — **preferred deploy plane**.

## Phases

| Phase | Status | What |
| --- | --- | --- |
| 1 | Done | Eve scaffold + YardDog-owned `AiSdkAdapter` / lanes + one Gateway turn |
| 2 | This PR | Hosted harness: crew, `@delegate` / `@consult` / `@escalate`, tools, approval, memory |

ModelHitch is **not** on the hosted happy path.

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
npm run dev          # Eve interactive session
```

### Crew job (Phase 2)

In the Eve session, ask YardDog to run a yard job — it should call **`yarddog_send`**, which runs `HostedYardDog` (directives + tools + memory).

Or smoke without the TUI:

```bash
# Scripted directives (no API key)
npm run smoke-directives

# Live AI Gateway crew turn
npm run smoke-directives -- --live "Have mule draft a one-line README blurb"
```

### Single adapter turn (Phase 1)

```bash
npm run smoke-turn -- "Say hello from the yard"
```

## Env

| Variable | Purpose |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (preferred for local) |
| `VERCEL_OIDC_TOKEN` | Alternative when linked to a Vercel project |
| `YARDDOG_WORKDIR` | Hosted harness workdir (default: cwd) |
| `YARDDOG_AUTO_APPROVE_TOOLS` | Set `0`/`false` to require approval on heavy tools |
| `YARDDOG_FAST_POOL` / `YARDDOG_HIGH_POOL` | Optional comma-separated Gateway model ids |

## Layout

| Path | Role |
| --- | --- |
| `agent/` | Eve foreman + instructions |
| `agent/tools/yarddog_send.ts` | Full hosted crew job (Phase 2) |
| `agent/tools/yarddog_gateway_turn.ts` | Single AiSdkAdapter turn (Phase 1) |
| `agent/subagents/*` | Crew slots (wrecker / spotter / mule) |
| `../src/core/hosted-harness.ts` | HostedYardDog — directives/tools/memory |
| `../src/model/` | YardDog-owned AI SDK adapter / lanes |

## Out of scope (later phases)

- Cursor Cloud `@delegate` tool
- ModelHitch removed from the Bun CLI harness (Phase 3 complete)
- Full MCP / hiring-hall parity on Eve
