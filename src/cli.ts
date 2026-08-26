#!/usr/bin/env bun
import { YardDog } from "./core/harness";

/**
 * yarddog — entry point.
 *
 *   yarddog            launch the OpenTUI yard floor
 *   yarddog ask "..."  headless: post a job to the crew, print the transcript
 *   yarddog crew       list the crew
 */

function usage(): never {
  console.log(`YardDog — multi-agent orchestration harness on ModelHitch

Usage:
  yarddog                Launch the terminal UI
  yarddog ask "<job>"    Run a job headless and print the result
  yarddog crew           Show the crew roster
  yarddog threads        List saved threads

Flags:
  --workdir <path>       Operate on a project directory (default: cwd)
  --auto-approve         Approve write/shell tool calls without prompting`);
  process.exit(0);
}

interface CliArgs {
  command: string;
  positional: string[];
  workdir?: string;
  autoApprove: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "tui", positional: [], autoApprove: false };
  const COMMANDS = new Set(["tui", "ask", "crew", "threads"]);
  const rest = [...argv];
  let sawCommand = false;
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--workdir") {
      args.workdir = rest.shift();
    } else if (arg === "--auto-approve" || arg === "-y") {
      args.autoApprove = true;
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") usage();

  if (args.command === "crew") {
    const dog = await YardDog.create({ workdir: args.workdir });
    console.log("Crew roster:");
    for (const agent of dog.agents) {
      console.log(`  @${agent.tag.padEnd(10)} ${agent.role}  [${agent.provider}/${agent.model}] tools=${agent.tools.join(",") || "none"}`);
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
    const dog = await YardDog.create({ workdir: args.workdir });
    dog.config.autoApproveTools = args.autoApprove;

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

    // In headless mode the human is watching; heavy tools are approved via flag only.
    dog.approveTool = async (_tag, name) => {
      if (args.autoApprove) return true;
      // Safe read-only tools pass; anything heavy gets declined with a hint.
      return ["read_file", "list_files", "grep"].includes(name);
    };

    const thread = dog.activeThread();
    await dog.send(thread.id, job);
    console.log("");
    return;
  }

  if (args.command === "tui") {
    const { runTui } = await import("./tui/app");
    await runTui();
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
