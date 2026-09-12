/**
 * Re-export YardDog-owned model plane into the Eve agent tree.
 * Hosted turns call AiSdkAdapter — ModelHitch is not on this path.
 */

export {
  AiSdkAdapter,
  DEFAULT_FAST_POOL,
  DEFAULT_HIGH_POOL,
  getLaneModel,
  getLaneModelPool,
  isRestrictionError,
  resolveModelLane,
} from "../../../src/model/index.ts";

export type {
  ChatMessage,
  ModelLane,
  ModelLaneConfig,
  ResolvedLaneModel,
  StreamTurnOptions,
  TaskComplexity,
  TurnChunk,
  TurnUsage,
} from "../../../src/model/index.ts";
