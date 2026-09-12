/**
 * Eve tool: run a full YardDog hosted crew job (Phase 2).
 *
 * Executes `@delegate` / `@consult` / `@escalate` via HostedYardDog with
 * AiSdkAdapter model turns — ModelHitch stays off this path.
 */

import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { HostedYardDog } from "../lib/yarddog-harness.ts";
import type { YardDogEvent } from "../../../src/core/types.ts";

/** Process-local hosted harness (crew + threads persist for the Eve session). */
let harnessPromise: Promise<HostedYardDog> | undefined;

function getHarness(): Promise<HostedYardDog> {
  if (!harnessPromise) {
    const workdir = process.env.YARDDOG_WORKDIR ?? process.cwd();
    const autoApproveTools =
      process.env.YARDDOG_AUTO_APPROVE_TOOLS !== "0" &&
      process.env.YARDDOG_AUTO_APPROVE_TOOLS !== "false";
    harnessPromise = HostedYardDog.create({
      workdir,
      config: { autoApproveTools },
    });
  }
  return harnessPromise;
}

export default defineTool({
  description:
    "Run a YardDog crew job on the hosted harness: house crew with @delegate / @consult / @escalate, tools, approval, and memory. Uses YardDog AiSdkAdapter (AI Gateway) — not ModelHitch.",
  inputSchema: z.object({
    message: z
      .string()
      .min(1)
      .describe("User message / job for the yard crew (may @mention agents)"),
    threadId: z
      .string()
      .optional()
      .describe("Existing YardDog thread id; omit to use the active thread"),
    title: z
      .string()
      .optional()
      .describe("Title when creating a new thread"),
  }),
  approval: never(),
  async execute({ message, threadId, title }) {
    const dog = await getHarness();

    let thread = threadId ? dog.getThread(threadId) : undefined;
    if (!thread) {
      thread = title ? dog.createThread(title) : dog.activeThread();
    }

    const events: Array<{ type: string; summary?: string }> = [];
    const onEvent = (event: YardDogEvent) => {
      switch (event.type) {
        case "handoff":
          events.push({
            type: "handoff",
            summary: `→ @${event.handoff.to}: ${event.handoff.task}`,
          });
          break;
        case "consult":
          events.push({
            type: "consult",
            summary: `? @${event.consult.to}: ${event.consult.question}`,
          });
          break;
        case "escalate":
          events.push({
            type: "escalate",
            summary: event.escalation.question,
          });
          break;
        case "tool":
          events.push({ type: "tool", summary: event.name });
          break;
        default:
          break;
      }
    };

    dog.on("event", onEvent);
    try {
      await dog.send(thread.id, message);
    } finally {
      dog.off("event", onEvent);
    }

    const updated = dog.getThread(thread.id)!;
    const agentReplies = updated.messages
      .filter((m) => m.from !== "user" && !m.handoffs?.length && !m.consult)
      .slice(-8)
      .map((m) => ({
        from: m.from,
        text: m.text,
        escalation: m.escalation?.question,
      }));

    const escalation = [...updated.messages].reverse().find((m) => m.escalation)?.escalation;

    return {
      ok: true,
      threadId: updated.id,
      modelHitch: false,
      via: "hosted-yarddog+ai-sdk",
      crew: dog.agents.map((a) => ({ tag: a.tag, role: a.role })),
      events,
      replies: agentReplies,
      escalation: escalation
        ? { from: escalation.from, question: escalation.question }
        : undefined,
      transcriptLength: updated.messages.length,
    };
  },
});
