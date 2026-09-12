import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FAST_POOL,
  DEFAULT_HIGH_POOL,
  getLaneModel,
  getLaneModelPool,
  isRestrictionError,
  resolveModelLane,
} from "../../src/model/lanes";

describe("resolveModelLane", () => {
  test("honors explicit lane", () => {
    expect(resolveModelLane({ requestedLane: "high" }).lane).toBe("high");
    expect(resolveModelLane({ requestedLane: "fast" }).lane).toBe("fast");
  });

  test("routes foreman / researcher to high", () => {
    expect(resolveModelLane({ role: "foreman" }).lane).toBe("high");
    expect(resolveModelLane({ role: "researcher" }).lane).toBe("high");
  });

  test("routes complexity and prompt signals", () => {
    expect(resolveModelLane({ taskComplexity: "coding" }).lane).toBe("high");
    expect(resolveModelLane({ taskComplexity: "quick_response" }).lane).toBe("fast");
    expect(resolveModelLane({ prompt: "Please audit the security architecture" }).lane).toBe(
      "high",
    );
  });

  test("defaults to fast", () => {
    expect(resolveModelLane({ prompt: "hi" }).lane).toBe("fast");
  });
});

describe("getLaneModelPool / getLaneModel", () => {
  test("returns default pools", () => {
    expect(getLaneModelPool("high")[0]).toBe(DEFAULT_HIGH_POOL[0]);
    expect(getLaneModelPool("fast")[0]).toBe(DEFAULT_FAST_POOL[0]);
  });

  test("prefers config overrides", () => {
    const pool = getLaneModelPool("fast", {
      fastPool: ["openai/gpt-4o-mini", "google/gemini-2.5-flash"],
    });
    expect(pool).toEqual(["openai/gpt-4o-mini", "google/gemini-2.5-flash"]);

    const resolved = getLaneModel("high", { highModel: "openai/gpt-4o" });
    expect(resolved.modelId).toBe("openai/gpt-4o");
    expect(resolved.modelPool[0]).toBe("openai/gpt-4o");
    expect(resolved.modelPool.length).toBeGreaterThan(1);
  });
});

describe("isRestrictionError", () => {
  test("detects gateway restriction / rate-limit shapes", () => {
    expect(isRestrictionError(new Error("free tier users do not have access"))).toBe(true);
    expect(isRestrictionError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRestrictionError(new Error("model_not_found"))).toBe(true);
    expect(isRestrictionError(new Error("connection reset"))).toBe(false);
  });
});
