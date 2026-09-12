/**
 * Shared model-turn runner for HostedYardDog and Bun YardDog.
 * AI SDK + YardDog lanes only — never ModelHitch.
 */

import { jsonSchema, stepCountIs, streamText, tool } from "ai";
import { TOOLS } from "./tools";
import type { AgentDef } from "./types";
import {
  AiSdkAdapter,
  getLaneModel,
  resolveModelLane,
  type ChatMessage,
  type ModelLane,
  type TurnUsage,
} from "../model";

export type ModelTurnToolDef = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

/** Injected model turn (production default or test fake). */
export type ModelTurn = (args: {
  agent: AgentDef;
  messages: ChatMessage[];
  /** Built-in registry tool names. */
  toolNames: string[];
  /** Extra tools (MCP, etc.) with JSON-schema parameters. */
  extraTools?: ModelTurnToolDef[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxTurns: number;
  onDelta?: (text: string) => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
  /** Called when the lane pool advances after a failed model. */
  onFailover?: () => void;
}) => Promise<{
  text: string;
  modelId?: string;
  lane?: ModelLane;
  usage?: TurnUsage;
  turns?: number;
  failedOver?: boolean;
}>;

/** @deprecated Use ModelTurn — kept as alias for HostedYardDog callers. */
export type HostedModelTurn = ModelTurn;

export function defaultModelTurn(adapter: AiSdkAdapter): ModelTurn {
  return async ({
    agent,
    messages,
    toolNames,
    extraTools = [],
    executeTool,
    maxTurns,
    onDelta,
    onTool,
    onFailover,
  }) => {
    const hasTools = toolNames.length > 0 || extraTools.length > 0;

    if (!hasTools) {
      let text = "";
      let modelId: string | undefined;
      let lane: ModelLane | undefined;
      let usage: TurnUsage | undefined;
      let failedOver = false;
      for await (const chunk of adapter.streamTurn({
        messages,
        role: agent.tag,
        temperature: agent.temperature,
      })) {
        if (chunk.type === "lane") {
          lane = chunk.lane;
          modelId = chunk.modelId;
        } else if (chunk.type === "text-delta") {
          text += chunk.text;
          onDelta?.(chunk.text);
        } else if (chunk.type === "failover") {
          failedOver = true;
          onFailover?.();
        } else if (chunk.type === "finish") {
          text = chunk.text || text;
          modelId = chunk.modelId;
          lane = chunk.lane;
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }
      return { text, modelId, lane, usage, turns: 1, failedOver };
    }

    const prompt = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    const { lane } = resolveModelLane({ role: agent.tag, prompt });
    const resolved = getLaneModel(lane, {});
    const pool = resolved.modelPool;

    const aiTools: Record<string, unknown> = {};
    for (const name of toolNames) {
      const spec = TOOLS[name];
      if (!spec) continue;
      const parameters =
        (spec.def as { parameters?: Record<string, unknown> }).parameters ??
        ({ type: "object", properties: {} } as Record<string, unknown>);
      aiTools[name] = tool({
        description: spec.def.description ?? name,
        inputSchema: jsonSchema(parameters),
        execute: async (args) => {
          const record = args as Record<string, unknown>;
          onTool?.(name, record);
          return executeTool(name, record);
        },
      });
    }
    for (const t of extraTools) {
      const parameters =
        t.parameters ?? ({ type: "object", properties: {} } as Record<string, unknown>);
      aiTools[t.name] = tool({
        description: t.description ?? t.name,
        inputSchema: jsonSchema(parameters),
        execute: async (args) => {
          const record = args as Record<string, unknown>;
          onTool?.(t.name, record);
          return executeTool(t.name, record);
        },
      });
    }

    let lastError: unknown;
    for (let i = 0; i < pool.length; i++) {
      const modelId = pool[i]!;
      try {
        const result = streamText({
          model: modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          tools: aiTools as Record<string, any>,
          temperature: agent.temperature,
          stopWhen: stepCountIs(maxTurns),
        });

        let text = "";
        for await (const delta of result.textStream) {
          text += delta;
          onDelta?.(delta);
        }
        const finalText = (await result.text) || text;
        const usageRaw = await result.usage;
        if (i > 0) onFailover?.();
        return {
          text: finalText,
          modelId,
          lane,
          usage: usageRaw
            ? {
                inputTokens: usageRaw.inputTokens,
                outputTokens: usageRaw.outputTokens,
                totalTokens: usageRaw.totalTokens,
              }
            : undefined,
          turns: maxTurns,
          failedOver: i > 0,
        };
      } catch (err) {
        lastError = err;
        if (i === pool.length - 1) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

/** @deprecated alias */
export const defaultHostedModelTurn = defaultModelTurn;
