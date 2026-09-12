# YardDog run paths — local adapter & Eve-hosted

Phase 5 makes the Bun CLI / OpenTUI a **client** of the preferred Eve-hosted
runtime, with a **local adapter fallback** when Eve is unset or unhealthy.

```text
                    ┌─────────────────────────────┐
                    │  yarddog CLI / OpenTUI      │
                    │  (ask, status, tui)         │
                    └─────────────┬───────────────┘
                                  │
              auto / --eve / YARDDOG_EVE_URL
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
   Eve HTTP client (`/eve/v1/*`)            Local YardDog adapter
   hosted/ on Node 24 + Eve                 Bun in-process harness
   HostedYardDog + AI Gateway               AiSdkAdapter + just-bash
```

## Quick chooser

| Goal | Command |
| --- | --- |
| Local yard floor (default) | `bun run src/cli.ts tui` |
| Local headless job | `bun run src/cli.ts ask "…" --local` |
| Talk to Eve dev server | `YARDDOG_EVE_URL=http://127.0.0.1:2000 bun run src/cli.ts ask "…"` |
| Force Eve (no fallback) | `bun run src/cli.ts ask "…" --eve http://127.0.0.1:2000` |
| See resolved mode | `bun run src/cli.ts status` |
| Hosted Eve session (preferred deploy) | `cd hosted && npm run dev` |

## Local adapter path

Runs the full Bun harness in-process: crew, `@delegate` / `@consult` /
`@escalate`, tools, MCP, hiring hall, Cursor `@delegate`, just-bash computers.

```bash
# from repo root
bun install
export AI_GATEWAY_API_KEY=…          # or VERCEL_OIDC_TOKEN
# optional Cursor cloud @delegate
export CURSOR_API_KEY=…

bun run src/cli.ts status            # mode: local
bun run src/cli.ts ask "map the auth flow" --local
bun run src/cli.ts tui --local
bun run src/cli.ts serve             # localhost HTTP + SSE
```

Env knobs: `YARDDOG_MODE=local`, `YARDDOG_FAST_POOL` / `YARDDOG_HIGH_POOL`,
`YARDDOG_PORT`, `AI_GATEWAY_API_KEY`, `CURSOR_API_KEY`.

## Eve-hosted path (preferred)

Eve app under [`hosted/`](../hosted) is the preferred production plane.
The Bun CLI becomes a thin client of that deployment’s Eve channel API.

```bash
# terminal A — Eve host (Node 24+)
cd hosted
cp .env.example .env.local   # AI_GATEWAY_API_KEY=…
npm install
npm run dev                  # typically http://127.0.0.1:2000

# terminal B — Bun client
export YARDDOG_EVE_URL=http://127.0.0.1:2000
# optional: YARDDOG_EVE_TOKEN / EVE_TOKEN for protected deployments
bun run src/cli.ts status    # mode: eve · health: ready
bun run src/cli.ts ask "Have the yard draft a one-line README blurb"
bun run src/cli.ts tui       # header shows YARDDOG · eve
```

Inside an Eve interactive session you can still call tools directly:

- `yarddog_send` — full hosted crew job (`HostedYardDog`)
- `yarddog_gateway_turn` — single AiSdkAdapter turn
- `yarddog_dispatch_cursor` — Cursor Cloud `@delegate`

```bash
cd hosted
npm run smoke-directives
npm run smoke-turn -- "Say hello from the yard"
```

## Mode resolution

| Input | Result |
| --- | --- |
| (default) no `YARDDOG_EVE_URL` | **local** |
| `YARDDOG_EVE_URL` set (auto) | **eve**, fall back to local if `/eve/v1/health` fails |
| `--local` / `YARDDOG_MODE=local` | **local** (no Eve) |
| `--eve [url]` / `YARDDOG_MODE=eve` | **eve** only (error if unhealthy / no URL) |

Implementation: `src/client/` (`mode.ts`, `eve.ts`, `open.ts`).

## What stays local-only (for now)

Even when the CLI is in Eve client mode:

- `--hire` / hiring hall discovery
- MCP connect listing via `yarddog mcp`
- `yarddog serve` HTTP floor
- Full crew presence / thread persistence UX in TUI (Eve mode is chat-shaped)

Phase 6 hardens failover honesty, Agent Runs, and skills/MCP parity on Eve.
