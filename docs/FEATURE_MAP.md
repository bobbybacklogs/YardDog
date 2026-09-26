# YardDog Feature Map

Honest inventory of **crew**, **directives**, and **hosted vs local adapter** claims.
This is a bootstrap map: grades come from repo inspection and the default no-key
verify path. It does not invent product behavior.

See also: [`docs/run-paths.md`](./run-paths.md), [`.agents/skills/verify-yarddog/SKILL.md`](../.agents/skills/verify-yarddog/SKILL.md).

## Grades

| Grade | Meaning |
| --- | --- |
| **Proven** | Exercised by an automated test or no-key smoke in this repo. |
| **Code-inspected** | Implementation exists and was read; no dedicated automated proof, or proof is mock-only. |
| **Unverified** | Claimed or wired, but not run here (needs keys, a live Eve host, or a human TUI). |
| **Gap** | Missing, local-only, or docs contradict code. Do not treat as shipped parity. |

Do not promote a claim by writing features or weakening tests. Re-grade after new evidence.

---

## 1. Crew

Default house crew is `defaultCrew()` in [`src/core/crew.ts`](../src/core/crew.ts).
Both `YardDog` (local) and `HostedYardDog` load it when `.yarddog/agents.json` is absent.

| Claim | Grade | Evidence |
| --- | --- | --- |
| House tags `@foreman`, `@wrecker`, `@spotter`, `@mule` exist with the advertised roles / tool lists | **Proven** | `src/core/crew.ts`; `tests/prompts.test.ts` renders roster + persona |
| Foreman is first in the array and therefore the default responder when no `@mention` | **Code-inspected** | `runJob` in `src/core/harness.ts` and `src/core/hosted-harness.ts` uses `crew[0]` |
| Crew + tools + memory persist under `<workdir>/.yarddog/` | **Code-inspected** | `src/core/store.ts`; hosted remember persist covered in `tests/hosted-harness.test.ts` |
| Prompt injects roster + `@delegate` / `@consult` / `@escalate` protocol (up to three parallel delegates) | **Proven** | `src/core/prompts.ts`; `tests/prompts.test.ts` |
| Hosted Eve subagents (`hosted/agent/subagents/*`) **are** the house crew | **Gap** | Those are Eve generic agents (own `defineAgent` + instructions). Hosted crew jobs go through `yarddog_send` → `HostedYardDog`, which uses `defaultCrew()`, not Eve subagent runtime |
| Editing `.yarddog/agents.json` adds / changes crew members | **Code-inspected** | `Store.loadCrew` / `saveCrew`; no CLI editor; no test that a hand-edited extra agent is routed |
| Provider/model is never stored on agents; lanes own routing | **Proven** | `tests/routing.test.ts` |

---

## 2. Directives (`@delegate` / `@consult` / `@escalate`)

Parser: [`src/core/directives.ts`](../src/core/directives.ts) (`parseReply`).
Both harnesses execute the same A2A loop after parse.

| Claim | Grade | Evidence |
| --- | --- | --- |
| Trailing `@delegate(to:, task:)` is parsed, stripped, capped at 3; extras stripped | **Proven** | `tests/directives.test.ts` |
| `@consult(to:, question:)` parsed/stripped | **Proven** | `tests/hall.test.ts` |
| `@escalate(...)` outranks delegate and consult (cancels them) | **Proven** | `tests/directives.test.ts`, `tests/hall.test.ts` |
| Malformed directives stay visible rather than half-parsed | **Proven** | `tests/directives.test.ts` |
| **Hosted** `HostedYardDog` executes `@delegate`, `@consult` (answer then continue), `@escalate` (stops chain, presence `escalated`), and parallel delegates | **Proven** | `tests/hosted-harness.test.ts`; no-key `hosted/scripts/smoke-directives.ts` |
| **Local** `YardDog` executes the same directive loop | **Code-inspected** | `src/core/harness.ts` `runAgentTurn` is the same shape as hosted (parse → escalate → consult → parallel handoffs). Queue/routing tests inject scripted turns but do **not** assert handoff/consult/escalate execution on `YardDog` |
| Never delegate back to the delegator; skip unknown / self targets | **Code-inspected** | Filter in both harnesses (`next.tag !== agent.tag` and `h.to !== delegator`); no unit test names this rule |
| Consult budget capped at 4 per job; consult answers ignore directives | **Code-inspected** | `MAX_CONSULTS_PER_JOB = 4`, `ignoreDirectives: true` on consult-answer turns |
| Depth cap `config.maxDepth` (default 3) | **Code-inspected** | `Store.DEFAULT_CONFIG`; used in both harnesses; no dedicated overflow test |
| README “max one delegate per reply” | **Gap** | Contradicts `MAX_DELEGATES_PER_REPLY = 3`, prompts, and the earlier README “up to three” paragraph (`README.md` A2A rules block) |

---

## 3. Hosted vs local adapter

Phase 5: Bun CLI / OpenTUI is a **client**. Preferred runtime is Eve under [`hosted/`](../hosted);
local `YardDog` is the in-process fallback. Resolution: [`src/client/mode.ts`](../src/client/mode.ts),
open: [`src/client/open.ts`](../src/client/open.ts), Eve HTTP: [`src/client/eve.ts`](../src/client/eve.ts).

### Mode resolution

| Claim | Grade | Evidence |
| --- | --- | --- |
| No `YARDDOG_EVE_URL` → local | **Proven** | `tests/client.test.ts` |
| `YARDDOG_EVE_URL` + auto → eve + local fallback allowed | **Proven** | `tests/client.test.ts` |
| `--local` / `forceLocal` wins over URL | **Proven** | `tests/client.test.ts` |
| `--eve` / `YARDDOG_MODE=eve` requires a URL | **Proven** | `tests/client.test.ts` |
| Auto Eve unhealthy → local adapter (`fellBack`) | **Proven** | `tests/client.test.ts` `openYard` mock 503 |
| Forced Eve + unhealthy host errors (no fallback) | **Code-inspected** | `openFromTarget` throws when `allowFallback` is false |
| `yarddog status` prints mode / reason / health | **Code-inspected** | `src/cli.ts` `status` command; no CLI integration test |

### Local adapter (`YardDog`)

Runs the full Bun harness in-process: crew, directives, tools, MCP, hiring hall, skills, Cursor `@delegate`, just-bash computers.

| Claim | Grade | Evidence |
| --- | --- | --- |
| Scripted local jobs queue FIFO; a failed job does not kill the queue | **Proven** | `tests/queue.test.ts` |
| Built-in tools are workdir-confined | **Proven** | `tests/tools.test.ts` |
| `shell` computer: private home + read-only `/project` | **Proven** | `tests/computer.test.ts` |
| MCP floor connects, prefixes tools, invokes fixture | **Proven** | `tests/mcp.test.ts` |
| Hiring hall maps vendor tools; drops unknowns; ignores vendor models | **Proven** | `tests/hall.test.ts` (mapping only — not a live `portage` scan of this machine) |
| Skill library injects + stages companions | **Gap** (env) | `tests/library.test.ts` calls `prepareSkills(["firebase-crashlytics", …])` via skillswap. Unknown-skill + empty-request cases **Proven**. The two “real skill” cases fail when those names are not installed on the machine (this checkout: 2 fail). Do not stub them to green verify |
| AiSdkAdapter streams + failsover on restriction errors (injected `streamText`) | **Proven** | `tests/model/ai-sdk-adapter.test.ts`, `tests/model/lanes.test.ts` |
| Live local `ask` / TUI turn through AI Gateway | **Unverified** | Needs `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. TUI launch-stays-alive is **Proven** (`tests/tui-smoke.test.ts`) with a dummy key — it does not complete a model turn |
| `yarddog serve` HTTP + SSE floor | **Code-inspected** | `src/serve.ts`; no HTTP test |

### Eve-hosted path (`hosted/` + `HostedYardDog`)

Preferred deploy plane. Eve tools: `yarddog_send` (crew job), `yarddog_gateway_turn` (one adapter turn),
`yarddog_dispatch_cursor` (Cursor Cloud).

| Claim | Grade | Evidence |
| --- | --- | --- |
| `HostedYardDog` runs crew + directives + tools + approval + memory without ModelHitch | **Proven** | `tests/hosted-harness.test.ts`; `src/core/hosted-harness.ts` does not import ModelHitch |
| Scripted hosted directive smoke (no API key) | **Proven** | `hosted/scripts/smoke-directives.ts` → `{ ok: true, live: false, via: "scripted" }`. Default prompt `@mention`s `@mule`, so mention routing can skip `@foreman` (observed: 1 turn / 2 messages). Delegate/consult/escalate execution remains **Proven** in `tests/hosted-harness.test.ts` |
| Eve tool `yarddog_send` wraps `HostedYardDog.send` | **Code-inspected** | `hosted/agent/tools/yarddog_send.ts` |
| Eve tool `yarddog_gateway_turn` is one `AiSdkAdapter` turn | **Code-inspected** | `hosted/agent/tools/yarddog_gateway_turn.ts` |
| Hosted Eve session (`cd hosted && npm run dev`) actually calls those tools | **Unverified** | Prompt-only (`hosted/agent/instructions.md`). No test that Eve invokes `yarddog_send` |
| Live AI Gateway hosted turn (`smoke-turn` / `smoke-directives --live`) | **Unverified** | Requires `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`; env-gated in verify |
| Bun CLI `ask` / TUI against a real Eve `/eve/v1/*` host | **Unverified** | `EveClient` **Proven** against a mock fetch (`tests/client.test.ts`) only |
| Eve TUI is “chat-shaped”: header `YARDDOG · eve`, no crew presence / thread UX | **Code-inspected** | `src/tui/app.ts`: Eve submit is `eveRuntime.ask` + one feed line. A local `YardDog` is still constructed for roster/slash commands |

### Parity (what stays local-only)

Documented in `docs/run-paths.md` “What stays local-only”. Confirmed by reading `HostedYardDog` vs `YardDog` and the Eve client.

| Surface | Local `YardDog` | Hosted / Eve client | Grade |
| --- | --- | --- | --- |
| House crew + `@delegate` / `@consult` / `@escalate` | Yes | Yes (`HostedYardDog` / `yarddog_send`) | **Proven** hosted; **Code-inspected** local execution |
| Tools, approval, `remember` | Yes | Yes | **Proven** hosted remember + deny; **Proven** local tools |
| just-bash computers | Yes | Yes (`Computer` in hosted harness) | **Proven** computer unit tests (shared) |
| Cursor `@delegate` / `@cursorbay` | Yes | Yes (hosted tests mock `CursorPlane`; Eve `yarddog_dispatch_cursor`) | **Proven** mock hosted; **Unverified** live `CURSOR_API_KEY` |
| Hiring hall (`temps` / `--hire`) | Yes | **No** — CLI ignores `--hire` in Eve mode; `HostedYardDog` has no `hireTemp` | **Gap** |
| Skill library (`--skill`) | Yes | **No** — `openEve.ask` drops `opts.skills`; hosted harness has no `prepareSkills` | **Gap** |
| MCP floor | Yes | **No** — no `McpManager` on `HostedYardDog` | **Gap** |
| `yarddog serve` | Yes | **No** | **Gap** (documented local-only) |
| Full crew presence / thread persistence in TUI | Yes | **No** — Eve mode is chat-shaped | **Gap** (documented) |
| Lane failover counter / `failedOver` meta | Yes | Hosted turn path does not thread `onFailover` the same way | **Code-inspected** / Phase 6 note |
| Skills + MCP parity on Eve; Agent Runs; failover honesty | — | Called out as Phase 6 | **Gap** |

---

## 4. Doc drift (do not paper over)

These are documentation bugs, not missing features to implement in this bootstrap.

| Claim in docs | Reality | Grade |
| --- | --- | --- |
| README “20 tests” | Many more files under `tests/`; count is stale | **Gap** |
| README Requirements: `OPENCODE_API_KEY` / `mock/mock-model` | Happy path is `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN` + `AiSdkAdapter`. No mock-model provider in `src/model` | **Gap** |
| README A2A: “max one delegate per reply” | Code + prompts: up to three | **Gap** |
| `hosted/README.md` Phase 5 “This PR” | Phase 5 is already on `main` (`docs/run-paths.md`) | **Gap** (stale status line) |
| Hosted Eve `npm run dev` / Eve package | `hosted/package.json` `engines.node: >=24`; this agent ran Node 22 (`EBADENGINE`). Scripted `smoke-directives` still ran | **Unverified** for live Eve on Node 22 |

---

## 5. Default verify (no live keys)

From repo root, after `bun install` and `npm --prefix hosted install`:

```bash
bun run verify
```

That is typecheck + `bun test` + scripted `hosted:directives`.
It does **not** prove live Gateway, live Eve, or live Cursor.

Live (optional, env-gated):

```bash
VERIFY_LIVE=1 bun run verify
# or: bun run hosted:smoke -- "Say hello from the yard"
# or: npm --prefix hosted run smoke-directives -- --live "…"
```

Requires `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`.

## 6. Command proof (this bootstrap)

Recorded on the gardener PR checkout. Not a live Gateway run.

| Step | Result |
| --- | --- |
| `bun run typecheck` | pass |
| `bun test` | **106 pass / 2 fail / 108** — failures are `prepareSkills` real-skill cases (`firebase-crashlytics`, `firebase-hosting-basics` not on this machine) |
| `bun run hosted:directives` | pass — `{ "ok": true, "live": false, "via": "scripted", "modelHitch": false, "turns": 1, "messages": 2 }` |
| `VERIFY_LIVE=1` / `hosted:smoke` | **not run** — no `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN` |

`bun run verify` is therefore **red** until those skillswap names exist (or the tests become hermetic). That is a documented Gap, not a reason to change harness behavior.
