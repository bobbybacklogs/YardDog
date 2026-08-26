import { describe, expect, test } from "bun:test";
import { applyMemory, MAX_MEMORY_CHARS } from "../src/core/memory";
import { TOOLS, needsApproval } from "../src/core/tools";
import type { AgentDef } from "../src/core/types";

function agent(): AgentDef {
  return {
    id: "t",
    tag: "t",
    name: "T",
    role: "tester",
    systemPrompt: "",
    provider: "mock",
    model: "mock-model",
    memory: "",
    tools: ["remember"],
  };
}

describe("applyMemory", () => {
  test("append adds a dated line", () => {
    const a = agent();
    applyMemory(a, "append", "user prefers bun over npm");
    expect(a.memory).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] user prefers bun over npm$/);
  });

  test("appends accumulate with newlines", () => {
    const a = agent();
    applyMemory(a, "append", "one");
    applyMemory(a, "append", "two");
    expect(a.memory).toContain("one\n- ");
    expect(a.memory).toContain("two");
  });

  test("replace overwrites everything", () => {
    const a = agent();
    applyMemory(a, "append", "old note");
    applyMemory(a, "replace", "only this matters now");
    expect(a.memory).toBe("only this matters now");
  });

  test("overflow drops OLDEST lines first", () => {
    const a = agent();
    const filler = "x".repeat(300);
    for (let i = 0; i < 40; i++) applyMemory(a, "append", `note-${i} ${filler}`);
    expect(a.memory.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(a.memory).not.toContain("note-0 "); // oldest gone
    const lastNote = [...a.memory.matchAll(/note-(\d+)/g)].at(-1)?.[1];
    expect(lastNote).toBe("39"); // newest survives
  });

  test("empty notes are no-ops", () => {
    const a = agent();
    applyMemory(a, "append", "   ");
    expect(a.memory).toBe("");
  });
});

describe("remember tool glue", () => {
  test("registered and approval-free", () => {
    expect(TOOLS.remember).toBeDefined();
    expect(needsApproval("remember")).toBe(false);
  });

  test("routes through the ctx handler", async () => {
    const seen: Array<{ mode: string; note: string }> = [];
    const out = await TOOLS.remember!.execute(
      { note: "prefers terse replies" },
      {
        workdir: ".",
        agentTag: "t",
        remember: async (mode, note) => {
          seen.push({ mode, note });
          return "remembered";
        },
      },
    );
    expect(out).toBe("remembered");
    expect(seen).toEqual([{ mode: "append", note: "prefers terse replies" }]);
  });

  test("fails cleanly without a handler", () => {
    expect(
      TOOLS.remember!.execute({ note: "x" }, { workdir: ".", agentTag: "t" }),
    ).rejects.toThrow("no memory attached");
  });
});
