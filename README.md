# YardDog

```
 ██╗   ██╗ █████╗ ██████╗ ██████╗
 ██║   ██║██╔══██╝██╔══██╗██╔══██╗   multi-agent orchestration harness
 ██║   ██║███████║██████╔╝██║  ██║        built on ModelHitch
 ╚██╗ ██╔╝██╔══██║██╔══██╗██║  ██║
  ╚████╔╝ ██║  ██║██║  ██║██████╔╝
   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
```

YardDog is a no-nonsense multi-agent orchestration harness built directly on top of [ModelHitch](https://www.npmjs.com/package/modelhitch). Built for the unglamorous grunt work, it shuttles context, wrangles code, and hauls documentation across models like a terminal spotter truck moving freight. No bloated enterprise fluff — just raw, mechanical muscle to hitch up tasks and keep your agent fleet in gear.

## The idea

One persistent **crew** of teammate-style agents (Grok-Bot-shaped, not workflow-shaped):

- **They hand work to each other.** Any agent can end its reply with `@delegate(to: @teammate, task: ...)` — the harness strips the directive from what you see, renders a handoff chip, and mechanically runs the next leg. Depth-capped, no self-delegation, no ping-pong.
- **They page you only for judgment calls.** `@escalate(question)` stops the chain and flags a human.
- **Everyone sees the shared thread.** Agents read the transcript labeled by author tag — no copy-pasting notes between chats.
- **They remember.** Per-agent durable memory notes are injected into every turn, across sessions.
- **Every wheel rolls through ModelHitch.** One instance, BYOK keys, per-agent provider/model lanes, automatic 429/5xx failover, honest telemetry (`served via failover lane`, token counts).

## The default crew

| Tag | Role | Tools |
| --- | --- | --- |
| `@foreman` | Chief of staff — routes work, keeps the yard moving | none |
| `@wrecker` | Coder — writes/fixes code, runs builds and tests | read/write/list/grep/shell |
| `@spotter` | Scout — read-only codebase reconnaissance | read/list/grep |
| `@mule` | Docs hauler — READMEs, guides, changelogs | read/write/list/grep |

Edit `.yarddog/agents.json` to rewire lanes, prompts, memory, or add crew members. All agents default to the config lane; pin `provider`/`model` per agent to mix providers across the fleet.

## Run it

```bash
bun install

yarddog                          # OpenTUI yard floor (crew + thread + composer)
bun src/cli.ts                   # same thing from the repo

bun src/cli.ts ask "audit the repo and fix broken imports" --auto-approve
bun src/cli.ts ask "@spotter map the auth flow, then @mule document it"
bun src/cli.ts crew              # roster
bun src/cli.ts threads           # saved threads
```

Flags: `--workdir <path>` operate on another project directory · `--auto-approve` waive the write/shell approval gate.

## State

Everything lives under `<workdir>/.yarddog/`:

```
.yarddog/
├─ config.json     # default provider/model lane, maxDepth, autoApproveTools
├─ agents.json     # the crew
└─ threads/<id>.json
```

Delete it for a fresh yard.

## Architecture

```
src/
├─ cli.ts               entry: tui | ask | crew | threads
├─ core/
│  ├─ types.ts          AgentDef, ThreadMessage, events — pure JSON-safe data
│  ├─ harness.ts        YardDog engine: one ModelHitch, crew, threads,
│  │                    send() → agent turns → directive execution loop
│  ├─ directives.ts     @delegate / @escalate parse + strip
│  ├─ prompts.ts        persona ⊕ memory ⊕ team roster ⊕ teamwork protocol
│  ├─ tools.ts          workdir-confined tool registry + approval gate
│  ├─ store.ts          JSON persistence under .yarddog/
│  └─ crew.ts           default freight-themed crew
└─ tui/app.ts           OpenTUI yard floor
tests/                   bun test — protocol, prompts, tools
```

### The A2A wire protocol

Agents collaborate through plain text at the tail of a reply — no hidden channels, fully auditable in the transcript:

```
@delegate(to: @tag, task: one sentence)
@escalate(question for the human)
```

Rules enforced by the harness (not just the prompt): max one delegate per reply, never delegate back to your delegator, escalation overrides delegation, orchestration depth capped at `config.maxDepth`.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- Node.js is *not* required at runtime; ModelHitch's bridge features (not used here) need Node 22.5+
- API keys via environment variables or `.env` (`OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …). Use `mock/mock-model` as a provider to run the whole pipeline with zero keys.

```bash
bun test            # 20 tests
bun typecheck       # tsc --noEmit
```

## License

MIT
