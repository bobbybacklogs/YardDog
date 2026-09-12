#!/usr/bin/env bun
import { YardDog } from "./core/harness";
import {
  describeYardTarget,
  openYard,
  type OpenYardOptions,
} from "./client";

/**
 * yarddog — entry point.
 *
 *   yarddog            launch the OpenTUI yard floor
 *   yarddog ask "..."  headless: post a job to the crew, print the transcript
 *   yarddog crew       list the crew
 */

function usage(): never {
  console.log(`YardDog — multi-agent orchestration harness on AI Gateway

Usage:
  yarddog                Launch the terminal UI
  yarddog ask "<job>"    Run a job headless and print the result
  yarddog crew           Show the house crew
  yarddog temps          List hireable temps found in local agent directories
  yarddog hire <name>... Hire temps onto this session's roster
  yarddog fire <tag>...  Fire temps from the roster (session-scoped)
  yarddog threads        List saved threads
  yarddog serve          HTTP + SSE surface for the yard (localhost only)
  yarddog mcp            Connect configured MCP servers and list their tools
  yarddog status         Show resolved client mode (local vs Eve)

Flags:
  --workdir <path>       Operate on a project directory (default: cwd)
  --auto-approve         Approve write/shell tool calls without prompting
  --hire <name,...>      Hire temps (from local agent directories) for this run
  --skill <name,...>     Attach library skills to the job (see: yarddog skills)
  --port <n>             Port for serve (default 4343 or $YARDDOG_PORT)
  --local                Force local adapter (ignore YARDDOG_EVE_URL)
  --eve [url]            Force Eve client (URL optional if YARDDOG_EVE_URL is set)

Client mode (Phase 5):
  Default is auto — Eve when YARDDOG_EVE_URL is set and healthy, else local.
  See docs/run-paths.md for local + hosted run paths.

Getting the command:
  Not yet published to npm — \`npx yarddog\` will 404 until it is.
  In the repo:      bun run src/cli.ts tui
  Global command:   bun link            (puts \`yarddog\` on PATH via ~/.bun/bin)
  Anywhere, no Bun: bun run build        (compiles bin/yarddog, a standalone executable)`);
  process.exit(0);
}

interface CliArgs {
  command: string;
  positional: string[];
  workdir?: string;
  autoApprove: boolean;
  hires: string[];
  skills: string[];
  port?: number;
  forceLocal: boolean;
  forceEve: boolean;
  eveUrl?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "tui",
    positional: [],
    autoApprove: false,
    hires: [],
    skills: [],
    forceLocal: false,
    forceEve: false,
  };
  const COMMANDS = new Set(["tui", "ask", "status", "crew", "threads", "temps", "hire", "fire", "skills", "serve", "mcp"]);
  const rest = [...argv];
  let sawCommand = false;
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--workdir") {
      args.workdir = rest.shift();
    } else if (arg === "--auto-approve" || arg === "-y") {
      args.autoApprove = true;
    } else if (arg === "--port") {
      args.port = Number(rest.shift());
    } else if (arg === "--local") {
      args.forceLocal = true;
    } else if (arg === "--eve") {
      args.forceEve = true;
      const next = rest[0];
      if (next && !next.startsWith("-") && !COMMANDS.has(next)) {
        args.eveUrl = next;
        rest.shift();
      }
    } else if (arg === "--hire") {
      // Comma-separated list: --hire a,b,c (repeatable)
      const next = rest[0];
      if (next && !next.startsWith("-")) {
        for (const name of next.split(",")) {
          const trimmed = name.trim();
          if (trimmed) args.hires.push(trimmed);
        }
        rest.shift();
      }
    } else if (arg === "--skill") {
      // Comma-separated list: --skill a,b (repeatable)
      const next = rest[0];
      if (next && !next.startsWith("-")) {
        for (const name of next.split(",")) {
          const trimmed = name.trim();
          if (trimmed) args.skills.push(trimmed);
        }
        rest.shift();
      }
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (!sawCommand && COMMANDS.has(arg)) {
      args.command = arg;
      sawCommand = true;
    } else if (!arg.startsWith("-")) {
      // Everything else is payload text (e.g. the job for `ask`).
      args.positional.push(arg);
    }
    // skip unknown flags silently for v1
  }
  return args;
}

/** Hire any requested temps onto a fresh session's roster. */
async function hireRequested(
  dog: { hireTemp(name: string): Promise<{ def: { tag: string }; notes: string[] }> },
  hires: string[],
): Promise<void> {
  for (const name of hires) {
    try {
      const { def, notes } = await dog.hireTemp(name);
      console.log(`hired @${def.tag} — tools listed in receipt above`);
      for (const note of notes) console.log(`  note: ${note}`);
    } catch (err) {
      console.error(`✗ hire failed: ${(err as Error).message}`);
    }
  }
}


function clientOptionsFromArgs(args: CliArgs): OpenYardOptions {
  return {
    workdir: args.workdir,
    forceLocal: args.forceLocal,
    forceEve: args.forceEve,
    eveUrl: args.eveUrl,
    log: (line) => console.error(`yarddog: ${line}`),
  };
}

async function runAskEve(args: CliArgs, job: string): Promise<void> {
  if (args.hires.length > 0) {
    console.error("yarddog: --hire is local-only; ignoring temps in Eve client mode");
  }
  const runtime = await openYard({
    ...clientOptionsFromArgs(args),
    forceEve: true,
    fallbackToLocal: false,
  });
  try {
    console.error(`yarddog: Eve client @ ${runtime.eveUrl} (${runtime.reason})`);
    const result = await runtime.ask(job, { skills: args.skills });
    if (result.text) process.stdout.write(result.text);
    if (!result.text.endsWith("\n")) console.log("");
    if (result.sessionId) console.error(`yarddog: session ${result.sessionId}`);
  } finally {
    await runtime.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") usage();

  if (args.command === "status") {
    const target = describeYardTarget(clientOptionsFromArgs(args));
    console.log(`mode:     ${target.mode}`);
    console.log(`reason:   ${target.reason}`);
    if (target.eveUrl) console.log(`eve:      ${target.eveUrl}`);
    console.log(
      `fallback: ${target.allowLocalFallback ? "local adapter if Eve unhealthy" : "none"}`,
    );
    if (target.mode === "eve" && target.eveUrl) {
      const { EveClient } = await import("./client/eve");
      const eve = new EveClient({
        host: target.eveUrl,
        bearer: process.env.YARDDOG_EVE_TOKEN ?? process.env.EVE_TOKEN,
      });
      const ready = await eve.isReady();
      console.log(`health:   ${ready ? "ready" : "unreachable"}`);
    }
    return;
  }


  if (args.command === "temps") {
    const { discoverTemps } = await import("./core/hall");
    const dog = await YardDog.create({ workdir: args.workdir });
    const available = await discoverTemps(args.workdir);
    const hired = new Set(dog.temps().map((t) => t.tag));
    console.log(`Hireable temps in local agent directories:\n`);
    for (const t of available) {
      console.log(`${hired.has(t.tag) ? "[HIRED]" : "       "} ${t.tag.padEnd(34)} (${t.vendor})`);
      console.log(`        ${(t.description || "(no description)").slice(0, 100)}`);
    }
    if (available.length === 0) console.log("  (none found)");
    return;
  }

  if (args.command === "hire") {
    const dog = await YardDog.create({ workdir: args.workdir });
    for (const name of args.positional) {
      try {
        const { def, notes } = await dog.hireTemp(name);
        console.log(`hired @${def.tag} (${def.temp?.vendor}) — tools: ${def.tools.join(", ") || "none"}`);
        for (const note of notes) console.log(`  note: ${note}`);
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
      }
    }
    return;
  }

  if (args.command === "fire") {
    const dog = await YardDog.create({ workdir: args.workdir });
    for (const tag of args.positional) {
      console.log(dog.fireTemp(tag) ? `fired @${tag.toLowerCase()}` : `@${tag.toLowerCase()} is not on payroll`);
    }
    return;
  }

  if (args.command === "skills") {
    const { discoverSkillLibrary } = await import("./core/library");
    const library = await discoverSkillLibrary(args.workdir);
    console.log(`Skill library (${library.length} skills found on this machine):\n`);
    for (const s of library) {
      console.log(`  ${s.name.padEnd(40)} ${s.bodyChars} chars, ${s.companions} companion file(s)`);
      console.log(`        ${(s.description || "(no description)").slice(0, 100)}`);
    }
    if (library.length === 0) console.log("  (none found)");
    return;
  }

  if (args.command === "serve") {
    const { startServe } = await import("./serve");
    const dog = await YardDog.create({ workdir: args.workdir });
    dog.config.autoApproveTools = args.autoApprove;
    await hireRequested(dog, args.hires);
    startServe(dog, { port: args.port });
    // serve keeps the process alive via Bun's active server handle
    return;
  }

  if (args.command === "mcp") {
    const dog = await YardDog.create({ workdir: args.workdir });
    const servers = Object.keys(dog.config.mcpServers ?? {});
    if (servers.length === 0) {
      console.log('No MCP servers configured. Add to .yarddog/config.json:');
      console.log('  "mcpServers": { "fetch": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] } }');
      return;
    }
    console.log("Connecting MCP servers…");
    const tools = await dog.mcp.listTools();
    for (const s of dog.mcp.status()) {
      console.log(`  ${s.connected ? "●" : "✗"} ${s.name}`);
    }
    console.log(`\n${tools.length} tool(s) available:\n`);
    for (const t of tools) {
      console.log(`  ${t.prefixedName.padEnd(44)} ${(t.description ?? "").slice(0, 60)}`);
    }
    await dog.mcp.shutdown();
    return;
  }

  if (args.command === "crew") {
    const dog = await YardDog.create({ workdir: args.workdir });
    console.log("Crew roster:");
    for (const agent of dog.agents) {
      console.log(`  @${agent.tag.padEnd(10)} ${agent.role}  [AI Gateway] tools=${agent.tools.join(",") || "none"}`);
    }
    return;
  }

  if (args.command === "threads") {
    const dog = await YardDog.create({ workdir: args.workdir });
    const threads = dog.listThreads();
    if (threads.length === 0) {
      console.log("No threads yet.");
      return;
    }
    for (const t of threads) {
      console.log(`  ${t.id}  ${t.title}  (${t.messages.length} messages, updated ${new Date(t.updatedAt).toLocaleString()})`);
    }
    return;
  }

  if (args.command === "ask") {
    const job = args.positional.join(" ").trim();
    if (!job.trim()) {
      console.error('Give the dog a job: yarddog ask "audit the repo and fix broken imports"');
      process.exit(1);
    }

    const target = describeYardTarget(clientOptionsFromArgs(args));
    let useLocal = target.mode === "local";
    if (target.mode === "eve") {
      try {
        await runAskEve(args, job);
        return;
      } catch (err) {
        if (!target.allowLocalFallback) throw err;
        console.error(
          `yarddog: Eve failed (${(err as Error).message}) — falling back to local`,
        );
        useLocal = true;
      }
    }

    if (!useLocal) return;

    console.error(`yarddog: local adapter (${target.reason})`);
    const dog = await YardDog.create({ workdir: args.workdir });
    dog.config.autoApproveTools = args.autoApprove;
    await hireRequested(dog, args.hires);

    dog.on("event", (event) => {
      switch (event.type) {
        case "turn:start":
          console.log(`\n▸ @${event.agentTag} picks it up`);
          break;
        case "delta":
          process.stdout.write(event.text);
          break;
        case "tool":
          console.log(`  ⚙ ${event.name}`);
          break;
        case "handoff":
          console.log(`\n⇄ handed off to @${event.handoff.to}: ${event.handoff.task}`);
          break;
        case "consult":
          console.log(`\n? @${event.consult.from} consulted @${event.consult.to}: ${event.consult.question}`);
          break;
        case "escalate":
          console.log(`\n! ESCALATED by @${event.escalation.from}: ${event.escalation.question}`);
          break;
        case "error":
          console.error(`\n✗ ${event.agentTag ? `@${event.agentTag}: ` : ""}${event.error}`);
          break;
        default:
          break;
      }
    });

    dog.approveTool = async (_tag, name) => {
      if (args.autoApprove) return true;
      return ["read_file", "list_files", "grep"].includes(name);
    };

    const thread = dog.activeThread();
    await dog.send(thread.id, job, { skills: args.skills });
    console.log("");
    return;
  }

  if (args.command === "tui") {
    const { runTui } = await import("./tui/app");
    await runTui({
      hires: args.hires,
      skills: args.skills,
      forceLocal: args.forceLocal,
      forceEve: args.forceEve,
      eveUrl: args.eveUrl,
    });
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
