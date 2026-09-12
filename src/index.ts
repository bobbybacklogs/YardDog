/**
 * yarddog — the public SDK surface.
 *
 * Import from any project:
 *
 *   import { YardDog, startServe, McpManager } from "yarddog"
 *   import type { AgentDef, YardDogEvent } from "yarddog"
 */

// ── core ──────────────────────────────────────────────────────────
export { YardDog } from "./core/harness";
export {
  HostedYardDog,
  type HostedYardDogOptions,
  type HostedModelTurn,
} from "./core/hosted-harness";
export { Store } from "./core/store";
export { Computer } from "./workspace/computer";
export { McpManager, type McpServerConfig } from "./mcp/host";

// ── server ────────────────────────────────────────────────────────
export { startServe, type ServeOptions } from "./serve";

// ── tools ─────────────────────────────────────────────────────────
export { TOOLS, type ToolContext, type ToolSpec } from "./core/tools";

// ── types (everything consumers may need) ─────────────────────────
export type {
  AgentDef,
  Consult,
  Escalation,
  Handoff,
  Presence,
  Thread,
  ThreadMessage,
  TurnMeta,
  YardDogEvent,
} from "./core/types";

// Re-export config + hall types for downstream convenience
export type { HarnessConfig } from "./core/store";
export type { HireResult, TempListing } from "./core/hall";

// ── model plane (AI SDK + AI Gateway; no ModelHitch on this path) ─
export {
  AiSdkAdapter,
  DEFAULT_FAST_POOL,
  DEFAULT_HIGH_POOL,
  getLaneModel,
  getLaneModelPool,
  isRestrictionError,
  resolveModelLane,
} from "./model";
export type {
  ChatMessage,
  ModelLane,
  ModelLaneConfig,
  ResolvedLaneModel,
  StreamTurnOptions,
  TaskComplexity,
  TurnChunk,
  TurnUsage,
} from "./model";

// ── Cursor @delegate plane (Phase 4) ──────────────────────────────
export {
  CURSOR_BAY_TAG,
  CursorPlane,
  isCursorDelegateTag,
} from "./cursor";
export type {
  CreateCursorAgent,
  CursorDispatchRequest,
  CursorJob,
  CursorJobStatus,
  CursorPlaneEvent,
  CursorPlaneOptions,
  CursorRepoRef,
} from "./cursor";

// ── client plane (Phase 5 — Eve HTTP client + local fallback) ─────
export {
  describeYardTarget,
  EveClient,
  EveClientError,
  extractAssistantText,
  openYard,
  readEveUrlFromEnv,
  readModeFromEnv,
  resolveClientTarget,
  type EveAskResult,
  type EveClientOptions,
  type EveHealth,
  type EveStreamEvent,
  type OpenYardOptions,
  type ResolvedClientTarget,
  type ResolvedYardClientMode,
  type YardAskResult,
  type YardClientMode,
  type YardClientModeOptions,
  type YardRuntime,
  type YardRuntimeKind,
} from "./client";
