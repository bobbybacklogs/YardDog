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

## The hiring hall

Your local agent directories are a labor pool. YardDog discovers agent definitions across every supported ecosystem (via [portage-cli](https://www.npmjs.com/package/portage-cli)) and hires them as **temps** — session-scoped workers that house agents treat exactly like teammates.

```bash
yarddog temps                                  # who's available on this machine
yarddog hire "Debug & Repair Generalist"       # inspect the hire receipt
yarddog ask "@debug-repair-generalist fix the flaky test" --hire "Debug & Repair Generalist"
yarddog tui --hire "Chrome Extension Reviewer,Final Validator"
```

- **Temps ride the A2A protocol for free**: once hired, they appear in every agent's team roster, so `@foreman` can `@delegate` or be consulted by them with zero configuration.
- **Session-scoped**: temps are never written to `.yarddog/agents.json` — when the session ends, they clock out.
- **Honest receipts**: vendor tool names (`read`, `search`, `web`, `vscode/*`) are mapped onto YardDog's real tools; anything without an equivalent is dropped and noted, never faked.
- **Model lanes**: explicit `provider/model` pairs in a spec are honored; vendor shorthand (`inherit`, `sonnet`) rides the config's default lane.

## The skill library

Temps bring labor; skills bring know-how. YardDog discovers Agent Skills (`SKILL.md`) across local directories (via [skillswap](https://github.com/genoventures-labs/skillswap)) and attaches them **per job**:

```bash
yarddog skills                                  # what's in the local library
yarddog ask "@mule set up crash reporting" --skill firebase-crashlytics
yarddog tui --skill firebase-firestore,firebase-auth   # session-wide attach
```

- Skill instructions are injected into every participating agent's system prompt for that job (bodies capped at 6k chars with truncation notes).
- Companion files are staged into `.yarddog/staged/<skill>/` inside the workdir, so agents can actually read them with their confined tools.
- Skills referencing vendor tools get a "use your closest equivalents" note — never fake capability.
- Attachments are recorded in the thread transcript for auditability.

## Computers — every worker gets a yard of their own

Any agent carrying the `shell` tool works inside a **sandboxed computer** (powered by [just-bash](https://github.com/vercel-labs/just-bash)):

```
/home/<tag>   private persistent workspace → .yarddog/workspaces/<tag>/ on disk
/project      the user's repo, mounted READ-ONLY
```

- Pipes, redirects, globs, coreutils; 30s wall-clock limit per command.
- Homes persist across turns and sessions — agents keep scratch notes, drafts, and work products.
- Agents are isolated: `@wrecker` cannot read `@mule`'s home.
- Writes to `/project` fail (`EROFS`) — repo integrity is enforced by the filesystem, not by prompt politeness.
- Two-tier shell policy: sandboxed `shell` is approval-free (writes confined to `.yarddog/workspaces/`); host-level `run_shell` stays behind the approval gate.

Note (Bun): just-bash's `defenseInDepth` layer is disabled here because it requires Node's `module.registerHooks`. Isolation comes from the filesystem layer itself.

## The MCP floor

YardDog is an **MCP host**. Declare servers in `.yarddog/config.json` — same shape as Claude Desktop / Cursor, so existing blocks are drop-in:

```json
{
  "mcpServers": {
    "fetch": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] },
    "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] }
  }
}
```

- Every discovered tool surfaces to the whole crew as `mcp__<server>__<tool>` and rides the normal tool-call loop
- MCP tools go through the **approval gate** by default (they're powerful by nature); `--auto-approve` waives it
- `yarddog mcp` connects and lists what's on the floor
- This is how temps get their platform's real tools back: `web`, `browser`, GitHub ops — each is one MCP server away, no first-party reimplementation

## Memory that compounds

Every worker — house crew and temps alike — carries a **`remember`** tool. It saves dated, durable notes into the agent's own memory, which is injected into every future turn:

- User preferences, project conventions, hard-won lessons, open threads
- Capped at 8k chars; when memory fills, the **oldest notes fall off first**
- House agents persist their memory to `.yarddog/agents.json`; temps keep session-scoped memory that clocks out with them

This is the compounding loop: the more you work with your crew, the less you repeat yourself.

## Judgment ground rules

Every agent — house or temp — works under the same authority line:

**In-scope** (ask `@foreman` in-thread via `@consult(to: @foreman, question: ...)`; work continues):
1. Work assignment and order
2. Approach selection when multiple valid paths exist
3. Quality bar — whether work satisfies the request
4. Retry/reassignment of stalled work
5. Convention calls consistent with project norms

**Out-of-scope** (page the human via `@escalate(...)`; the chain stops):
1. Irreversible actions beyond the stated job
2. Money beyond normal key operation
3. Secrets/auth/security-posture changes
4. Scope changes
5. Contradicting explicit user instructions
6. Anything not confidently classifiable as in-scope

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
├─ cli.ts               entry: tui | ask | crew | temps | hire | fire | threads | skills
├─ core/
│  ├─ types.ts          AgentDef, ThreadMessage, events — pure JSON-safe data
│  ├─ harness.ts        YardDog engine: one ModelHitch, crew, threads,
│  │                    send() → agent turns → directive execution loop
│  ├─ directives.ts     @delegate / @consult / @escalate parse + strip
│  ├─ prompts.ts        persona ⊕ memory ⊕ team roster ⊕ ground rules
│  ├─ hall.ts           the hiring hall: portage discovery → temp AgentDefs
│  ├─ library.ts        the skill library: skillswap discovery → job-scoped injection
│  ├─ tools.ts          tool registry + approval gate (+ sandboxed shell)
│  ├─ store.ts          JSON persistence under .yarddog/
│  └─ crew.ts           default freight crew
├─ workspace/
│  └─ computer.ts       per-agent sandbox: private home + read-only /project
├─ mcp/
│  └─ host.ts           MCP floor: stdio servers → crew-wide tools
└─ tui/app.ts           OpenTUI yard floor
tests/                   bun test — protocol, prompts, tools, hiring hall
```

### Parallel dispatch

The foreman doesn't have to babysit one job at a time. A reply can carry up to **three `@delegate` directives**, and sibling handoffs execute **concurrently** — `@wrecker` fixing imports while `@mule` updates docs in the same breath. Multiple `@mentions` in a user message also fan out in parallel. Consults stay sequential by nature (ask → answer → continue); escalations still stop everything.

### The A2A wire protocol

Agents collaborate through plain text at the tail of a reply — no hidden channels, fully auditable in the transcript:

```
@delegate(to: @tag, task: one sentence)
@consult(to: @tag, question: judgment call inside the ground rules)
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
