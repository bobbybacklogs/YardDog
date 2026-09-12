/**
 * YardDog model plane — AI SDK + AI Gateway (no ModelHitch on this path).
 */

export {
  DEFAULT_FAST_POOL,
  DEFAULT_HIGH_POOL,
  getLaneModel,
  getLaneModelPool,
  isRestrictionError,
  resolveModelLane,
} from "./lanes";
export { AiSdkAdapter, type AiSdkAdapterOptions } from "./ai-sdk-adapter";
export type {
  ChatMessage,
  ModelLane,
  ModelLaneConfig,
  ResolvedLaneModel,
  StreamTurnOptions,
  TaskComplexity,
  TurnChunk,
  TurnUsage,
} from "./types";
