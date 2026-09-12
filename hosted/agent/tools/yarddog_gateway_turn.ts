/**
 * Eve tool: run one YardDog-owned AI Gateway turn (no ModelHitch).
 *
 * Phase 1 happy path — AiSdkAdapter + lanes stream through Vercel AI Gateway
 * from inside the Eve-hosted agent.
 */

import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { AiSdkAdapter } from "../lib/yarddog-model.ts";

export default defineTool({
  description:
    "Run a single YardDog model turn through Vercel AI Gateway using YardDog's owned AiSdkAdapter and lane failover. Does not use ModelHitch.",
  inputSchema: z.object({
    prompt: z.string().min(1).describe("User prompt for this turn"),
    lane: z
      .enum(["high", "fast"])
      .optional()
      .describe("Optional forced model lane (high = reasoning, fast = low-latency)"),
    system: z.string().optional().describe("Optional system preamble for this turn"),
  }),
  approval: never(),
  async execute({ prompt, lane, system }) {
    const adapter = new AiSdkAdapter();
    const messages = [
      ...(system
        ? [{ role: "system" as const, content: system }]
        : [
            {
              role: "system" as const,
              content:
                "You are YardDog's hosted model lane. Be concise and practical. Do not mention ModelHitch.",
            },
          ]),
      { role: "user" as const, content: prompt },
    ];

    const deltas: string[] = [];
    let modelId: string | undefined;
    let usedLane: string | undefined;
    let reason: string | undefined;

    for await (const chunk of adapter.streamTurn({ messages, lane })) {
      if (chunk.type === "lane") {
        usedLane = chunk.lane;
        modelId = chunk.modelId;
        reason = chunk.reason;
      } else if (chunk.type === "text-delta") {
        deltas.push(chunk.text);
      } else if (chunk.type === "finish") {
        return {
          ok: true,
          text: chunk.text || deltas.join(""),
          lane: chunk.lane,
          modelId: chunk.modelId,
          reason,
          usage: chunk.usage,
          via: "ai-sdk+ai-gateway",
          modelHitch: false,
        };
      } else if (chunk.type === "error") {
        return {
          ok: false,
          error: chunk.error,
          modelId: chunk.modelId ?? modelId,
          lane: usedLane,
          reason,
          via: "ai-sdk+ai-gateway",
          modelHitch: false,
        };
      }
    }

    return {
      ok: true,
      text: deltas.join(""),
      lane: usedLane,
      modelId,
      reason,
      via: "ai-sdk+ai-gateway",
      modelHitch: false,
    };
  },
});
