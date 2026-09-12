/**
 * YardDog-owned model lanes for Vercel AI Gateway.
 *
 * Patterns inspired by Gateway-Workers `lanes.ts` — copied ideas only,
 * not a shared package.
 */

import type {
  ModelLane,
  ModelLaneConfig,
  ResolvedLaneModel,
  TaskComplexity,
} from "./types";

export const DEFAULT_HIGH_POOL = [
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-4o",
  "google/gemini-2.5-pro",
] as const;

export const DEFAULT_FAST_POOL = [
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash-lite",
] as const;

/**
 * Resolve whether a turn should use the high reasoning lane or the fast lane.
 */
export function resolveModelLane(options: {
  requestedLane?: ModelLane;
  role?: string;
  prompt?: string;
  taskComplexity?: TaskComplexity;
}): { lane: ModelLane; reason: string } {
  const { requestedLane, role, prompt = "", taskComplexity } = options;

  if (requestedLane === "high") {
    return { lane: "high", reason: "Explicitly requested high reasoning lane" };
  }
  if (requestedLane === "fast") {
    return { lane: "fast", reason: "Explicitly requested fast low-latency lane" };
  }

  const normalizedRole = (role || "").toLowerCase();
  if (normalizedRole === "foreman" || normalizedRole === "researcher") {
    return {
      lane: "high",
      reason: `Role '${normalizedRole}' prefers high reasoning capacity`,
    };
  }

  if (
    taskComplexity === "research" ||
    taskComplexity === "planning" ||
    taskComplexity === "coding"
  ) {
    return {
      lane: "high",
      reason: `Task complexity '${taskComplexity}' warrants higher reasoning capacity`,
    };
  }

  if (
    taskComplexity === "routing" ||
    taskComplexity === "quick_response" ||
    taskComplexity === "small_task"
  ) {
    return {
      lane: "fast",
      reason: `Task complexity '${taskComplexity}' optimized for fast lane throughput`,
    };
  }

  const highSignals = [
    /\b(architect|architecture|compare|benchmark|audit|security|evaluate|deep dive)\b/i,
    /\b(research|grounding|spec|rfc|analysis|trade-?offs|refactor)\b/i,
  ];
  if (highSignals.some((re) => re.test(prompt))) {
    return {
      lane: "high",
      reason: "Prompt contains deep reasoning or architectural signals",
    };
  }

  return {
    lane: "fast",
    reason: "Standard operational task suited for fast lane",
  };
}

function envList(name: string): string[] | undefined {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (!raw?.trim()) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Prioritized candidate model pool for a lane (AI Gateway `provider/model` ids).
 */
export function getLaneModelPool(
  lane: ModelLane,
  config: ModelLaneConfig = {},
): string[] {
  const envHighPool = envList("YARDDOG_HIGH_POOL") ?? envList("GATEWAY_HIGH_POOL");
  const envFastPool = envList("YARDDOG_FAST_POOL") ?? envList("GATEWAY_FAST_POOL");
  const envHighModel =
    typeof process !== "undefined"
      ? process.env?.YARDDOG_HIGH_MODEL ?? process.env?.GATEWAY_HIGH_MODEL
      : undefined;
  const envFastModel =
    typeof process !== "undefined"
      ? process.env?.YARDDOG_FAST_MODEL ?? process.env?.GATEWAY_FAST_MODEL
      : undefined;

  if (lane === "high") {
    if (config.highPool?.length) return [...config.highPool];
    if (envHighPool?.length) return envHighPool;
    if (config.highModel || envHighModel) {
      const top = (config.highModel || envHighModel)!;
      return [top, ...DEFAULT_HIGH_POOL.filter((m) => m !== top)];
    }
    return [...DEFAULT_HIGH_POOL];
  }

  if (config.fastPool?.length) return [...config.fastPool];
  if (envFastPool?.length) return envFastPool;
  if (config.fastModel || envFastModel) {
    const top = (config.fastModel || envFastModel)!;
    return [top, ...DEFAULT_FAST_POOL.filter((m) => m !== top)];
  }
  return [...DEFAULT_FAST_POOL];
}

/**
 * Resolve model id + auth hint for a lane (includes full failover pool).
 */
export function getLaneModel(
  lane: ModelLane,
  config: ModelLaneConfig = {},
): ResolvedLaneModel {
  const envKey =
    typeof process !== "undefined"
      ? process.env?.AI_GATEWAY_API_KEY ?? process.env?.VERCEL_OIDC_TOKEN
      : undefined;
  const pool = getLaneModelPool(lane, config);

  if (lane === "high") {
    return {
      lane: "high",
      modelId: pool[0]!,
      modelPool: pool,
      apiKey: config.highApiKey || envKey || config.fastApiKey,
      reason: `High reasoning lane prioritized with ${pool.length} candidate models`,
    };
  }

  return {
    lane: "fast",
    modelId: pool[0]!,
    modelPool: pool,
    apiKey: config.fastApiKey || envKey || config.highApiKey,
    reason: `Fast lane prioritized with ${pool.length} candidate models`,
  };
}

/**
 * True when an AI Gateway error suggests trying the next model in the pool.
 */
export function isRestrictionError(err: unknown): boolean {
  const msg = String(
    err && typeof err === "object" && "message" in err
      ? (err as { message: unknown }).message
      : err ?? "",
  ).toLowerCase();
  return (
    msg.includes("free tier users do not have access") ||
    msg.includes("upgrade to paid credits") ||
    msg.includes("restrictedmodelserror") ||
    msg.includes("no_providers_available") ||
    msg.includes("rate-limited") ||
    msg.includes("rate limit") ||
    msg.includes("model_not_found") ||
    msg.includes("model not found") ||
    msg.includes("does not have access")
  );
}
