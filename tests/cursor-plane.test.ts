import { describe, expect, test } from "bun:test";
import { CursorPlane, CURSOR_BAY_TAG, isCursorDelegateTag } from "../src/cursor";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";

function mockRun(messages: SDKMessage[], resultText = "hello from cloud"): Run {
  const run = {
    id: "run-1",
    agentId: "bc-test1234",
    status: "running" as const,
    supports: () => true,
    unsupportedReason: () => undefined,
    async *stream() {
      for (const m of messages) yield m;
    },
    async conversation() {
      return [];
    },
    async wait() {
      (run as { status: string }).status = "finished";
      return {
        id: "run-1",
        status: "finished" as const,
        result: resultText,
      };
    },
    async cancel() {
      (run as { status: string }).status = "cancelled";
    },
    onDidChangeStatus: () => () => {},
  };
  return run as unknown as Run;
}

function mockAgent(run: Run): SDKAgent {
  return {
    agentId: "bc-test1234",
    model: undefined,
    async send() {
      return run;
    },
    close() {},
    async reload() {},
    async [Symbol.asyncDispose]() {},
    async listArtifacts() {
      return [];
    },
    async downloadArtifact() {
      return Buffer.from("");
    },
    async getUsage() {
      return { total: {}, runs: [] } as never;
    },
  };
}

describe("CursorPlane", () => {
  test("isCursorDelegateTag recognizes bay and cursor-* tags", () => {
    expect(isCursorDelegateTag("cursorbay")).toBe(true);
    expect(isCursorDelegateTag("@cursorbay")).toBe(true);
    expect(isCursorDelegateTag("cursor-abc")).toBe(true);
    expect(isCursorDelegateTag("wrecker")).toBe(false);
  });

  test("dispatch streams deltas and finishes", async () => {
    const run = mockRun(
      [
        {
          type: "assistant",
          agent_id: "bc-test1234",
          run_id: "run-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello from cloud" }],
          },
        },
      ],
      "hello from cloud",
    );
    const plane = new CursorPlane({
      createAgent: async () => mockAgent(run),
    });
    const events: string[] = [];
    const job = await plane.dispatch(
      { task: "fix auth", tag: CURSOR_BAY_TAG },
      (ev) => events.push(ev.kind),
    );
    expect(job.status).toBe("finished");
    expect(job.tag).toBe(CURSOR_BAY_TAG);
    expect(job.text).toContain("hello from cloud");
    expect(events).toContain("delta");
    expect(events).toContain("finish");
    expect(plane.get("cursorbay")?.id).toBe(job.id);
  });

  test("cancel marks job cancelled", async () => {
    const run = mockRun([]);
    // Keep run running by making wait hang until cancel — for unit test just cancel after dispatch wait:false
    const plane = new CursorPlane({
      createAgent: async () => mockAgent(run),
    });
    const job = await plane.dispatch({ task: "long job", wait: false });
    expect(job.status).toBe("running");
    const cancelled = await plane.cancel(job.id);
    expect(cancelled?.status).toBe("cancelled");
  });

  test("dispatch without key throws when not mocked", async () => {
    const prev = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      const plane = new CursorPlane();
      expect(plane.ready).toBe(false);
      await expect(plane.dispatch({ task: "x" })).rejects.toThrow(/CURSOR_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.CURSOR_API_KEY = prev;
    }
  });
});
