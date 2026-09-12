/**
 * YardDog AI SDK adapter — streams turns through Vercel AI Gateway.
 * ModelHitch is not used on this path.
 */

import { streamText, type ModelMessage } from "ai";
import { getLaneModel, isRestrictionError, resolveModelLane } from "./lanes";
import type {
  ChatMessage,
  ModelLaneConfig,
  StreamTurnOptions,
  TurnChunk,
  TurnUsage,
} from "./types";

export interface AiSdkAdapterOptions {
  laneConfig?: ModelLaneConfig;
  /**
   * Inject a streamText implementation (tests). Defaults to AI SDK `streamText`
   * with Gateway model strings (`provider/model`).
   */
  streamTextFn?: typeof streamText;
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return { role: "system" as const, content: m.content };
    if (m.role === "assistant") return { role: "assistant" as const, content: m.content };
    return { role: "user" as const, content: m.content };
  });
}

function promptFromMessages(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

/**
 * Streams one chat turn via AI SDK + AI Gateway with YardDog-owned lane failover.
 */
export class AiSdkAdapter {
  private readonly laneConfig: ModelLaneConfig;
  private readonly streamTextFn: typeof streamText;

  constructor(options: AiSdkAdapterOptions = {}) {
    this.laneConfig = options.laneConfig ?? {};
    this.streamTextFn = options.streamTextFn ?? streamText;
  }

  async *streamTurn(options: StreamTurnOptions): AsyncIterable<TurnChunk> {
    const prompt = promptFromMessages(options.messages);
    const { lane, reason } = resolveModelLane({
      requestedLane: options.lane,
      role: options.role,
      prompt,
      taskComplexity: options.taskComplexity,
    });

    const mergedConfig: ModelLaneConfig = {
      ...this.laneConfig,
      ...options.laneConfig,
    };
    const resolved = getLaneModel(lane, mergedConfig);
    const pool = resolved.modelPool;

    yield {
      type: "lane",
      lane,
      modelId: pool[0]!,
      reason: `${reason} · ${resolved.reason}`,
    };

    const modelMessages = toModelMessages(options.messages);
    let lastError: unknown;

    for (let i = 0; i < pool.length; i++) {
      const modelId = pool[i]!;
      if (i > 0) {
        yield {
          type: "failover",
          fromModelId: pool[i - 1]!,
          toModelId: modelId,
          cause: String(
            lastError && typeof lastError === "object" && "message" in lastError
              ? (lastError as { message: unknown }).message
              : lastError ?? "restriction or provider error",
          ),
        };
      }

      try {
        const result = this.streamTextFn({
          model: modelId,
          messages: modelMessages,
          temperature: options.temperature,
        });

        let text = "";
        for await (const delta of result.textStream) {
          text += delta;
          yield { type: "text-delta", text: delta };
        }

        const usageRaw = await result.usage;
        const usage: TurnUsage | undefined = usageRaw
          ? {
              inputTokens: usageRaw.inputTokens,
              outputTokens: usageRaw.outputTokens,
              totalTokens: usageRaw.totalTokens,
            }
          : undefined;

        yield { type: "finish", modelId, lane, usage, text };
        return;
      } catch (err) {
        lastError = err;
        if (!isRestrictionError(err) || i === pool.length - 1) {
          yield {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
            modelId,
          };
          return;
        }
      }
    }
  }

  /** Convenience: collect a full turn into text + meta (no ModelHitch). */
  async completeTurn(
    options: StreamTurnOptions,
  ): Promise<{ text: string; modelId?: string; lane?: string; usage?: TurnUsage }> {
    let text = "";
    let modelId: string | undefined;
    let lane: string | undefined;
    let usage: TurnUsage | undefined;
    for await (const chunk of this.streamTurn(options)) {
      if (chunk.type === "text-delta") text += chunk.text;
      if (chunk.type === "finish") {
        text = chunk.text || text;
        modelId = chunk.modelId;
        lane = chunk.lane;
        usage = chunk.usage;
      }
      if (chunk.type === "error") {
        throw new Error(chunk.error);
      }
    }
    return { text, modelId, lane, usage };
  }
}
