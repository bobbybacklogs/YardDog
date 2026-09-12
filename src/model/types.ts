/**
 * YardDog-owned model types for the AI SDK + AI Gateway lane.
 * Independent of ModelHitch — Phase 1 happy path.
 */

export type ModelLane = "high" | "fast";

export type TaskComplexity =
  | "research"
  | "planning"
  | "coding"
  | "routing"
  | "quick_response"
  | "small_task";

export interface ModelLaneConfig {
  highPool?: string[];
  fastPool?: string[];
  highModel?: string;
  fastModel?: string;
  highApiKey?: string;
  fastApiKey?: string;
}

export interface ResolvedLaneModel {
  lane: ModelLane;
  modelId: string;
  modelPool: string[];
  apiKey?: string;
  reason: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type TurnChunk =
  | { type: "text-delta"; text: string }
  | { type: "lane"; lane: ModelLane; modelId: string; reason: string }
  | { type: "failover"; fromModelId: string; toModelId: string; cause: string }
  | {
      type: "finish";
      modelId: string;
      lane: ModelLane;
      usage?: TurnUsage;
      text: string;
    }
  | { type: "error"; error: string; modelId?: string };

export interface StreamTurnOptions {
  messages: ChatMessage[];
  /** Force a lane; otherwise resolved from role / prompt / complexity. */
  lane?: ModelLane;
  role?: string;
  taskComplexity?: TaskComplexity;
  temperature?: number;
  /** Override lane pools / keys for this call. */
  laneConfig?: ModelLaneConfig;
}
