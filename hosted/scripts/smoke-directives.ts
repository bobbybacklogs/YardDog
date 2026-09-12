/**
 * Smoke HostedYardDog directives without Eve TUI (Node).
 *
 * Uses a scripted model turn by default (no API key). Pass --live to hit AI Gateway.
 *
 * Usage:
 *   npm run smoke-directives
 *   npm run smoke-directives -- --live "Delegate a tiny docs task"
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostedYardDog } from "../agent/lib/yarddog-harness.ts";

const live = process.argv.includes("--live");
const prompt =
  process.argv.filter((a) => a !== "--live").slice(2).join(" ").trim() ||
  "Say hello and @delegate(to: @mule, task: draft a one-line README blurb)";

async function main() {
  const workdir = await mkdtemp(path.join(tmpdir(), "yarddog-directives-"));
  console.log("workdir", workdir);

  if (live) {
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      console.error("Missing AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN for --live");
      process.exit(2);
    }
  }

  const scripted = [
    "On it.\n@delegate(to: @mule, task: draft a one-line README blurb)",
    "README blurb: YardDog hosts a freight-yard multi-agent crew.",
  ];
  let i = 0;

  const dog = await HostedYardDog.create({
    workdir,
    config: { autoApproveTools: true },
    ...(live
      ? {}
      : {
          runModelTurn: async ({ agent }) => {
            const text =
              agent.tag === "foreman"
                ? scripted[0]!
                : agent.tag === "mule"
                  ? scripted[1]!
                  : `(${agent.tag}) ok`;
            // consume foreman script once
            if (agent.tag === "foreman") scripted[0] = `(${agent.tag}) follow-up`;
            i++;
            return { text, modelId: "scripted", lane: "fast" };
          },
        }),
  });

  const thread = dog.createThread("smoke-directives");
  await dog.send(thread.id, prompt);

  const msgs = dog.getThread(thread.id)!.messages;
  for (const m of msgs) {
    const flags = [
      m.handoffs?.length ? `handoffs=${m.handoffs.length}` : "",
      m.consult ? "consult" : "",
      m.escalation ? "escalate" : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`@${m.from}: ${m.text.slice(0, 120)}${flags ? `  [${flags}]` : ""}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        modelHitch: false,
        live,
        turns: i,
        messages: msgs.length,
        via: live ? "ai-sdk+ai-gateway" : "scripted",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
