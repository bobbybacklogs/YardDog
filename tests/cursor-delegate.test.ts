import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";
import { HostedYardDog } from "../src/core/hosted-harness";
import { CursorPlane, CURSOR_BAY_TAG } from "../src/cursor";

function mockRun(text: string): Run {
  const run = {
    id: "run-delegate",
    agentId: "bc-delegate1",
    status: "running" as const,
    supports: () => true,
    unsupportedReason: () => undefined,
    async *stream() {
      const msg: SDKMessage = {
        type: "assistant",
        agent_id: "bc-delegate1",
        run_id: "run-delegate",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
        },
      };
      yield msg;
    },
    async conversation() {
      return [];
    },
    async wait() {
      (run as { status: string }).status = "finished";
      return { id: "run-delegate", status: "finished" as const, result: text };
    },
    async cancel() {},
    onDidChangeStatus: () => () => {},
  };
  return run as unknown as Run;
}

function mockAgent(text: string): SDKAgent {
  const run = mockRun(text);
  return {
    agentId: "bc-delegate1",
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

describe("Cursor @delegate (Phase 4)", () => {
  test("HostedYardDog routes @delegate(to: @cursorbay) through CursorPlane", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-cursor-"));
    const plane = new CursorPlane({
      createAgent: async () => mockAgent("PR opened for auth fix"),
    });
    const dog = await HostedYardDog.create({
      workdir,
      cursorPlane: plane,
      config: { autoApproveTools: true, maxDepth: 3 },
      runModelTurn: async ({ agent }) => {
        if (agent.tag === "foreman") {
          return {
            text: "Sending to cloud.\n@delegate(to: @cursorbay, task: fix auth and open a PR)",
            modelId: "test",
            lane: "fast",
          };
        }
        return { text: "should not run", modelId: "test", lane: "fast" };
      },
    });

    const events: string[] = [];
    dog.on("event", (e: { type: string; agentTag?: string }) => {
      events.push(e.type + (e.agentTag ? `:${e.agentTag}` : ""));
    });

    const thread = dog.createThread("cursor delegate");
    await dog.send(thread.id, "please fix auth via cursor");

    const msgs = dog.getThread(thread.id)!.messages;
    expect(msgs.some((m) => m.from === CURSOR_BAY_TAG)).toBe(true);
    expect(msgs.some((m) => m.text.includes("PR opened for auth fix"))).toBe(true);
    expect(events.some((e) => e.startsWith("handoff"))).toBe(true);
  });

  test("dispatch_cursor_job tool is always on the floor", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-cursor-tool-"));
    const plane = new CursorPlane({
      createAgent: async () => mockAgent("tool path ok"),
    });
    let sawTool = false;
    const dog = await HostedYardDog.create({
      workdir,
      cursorPlane: plane,
      config: { autoApproveTools: true },
      runModelTurn: async ({ agent, toolNames, executeTool }) => {
        if (agent.tag === "foreman") {
          expect(toolNames).toContain("dispatch_cursor_job");
          expect(toolNames).toContain("cursor_job_status");
          expect(toolNames).toContain("cancel_cursor_job");
          const result = await executeTool("dispatch_cursor_job", {
            task: "do the thing",
            wait: true,
          });
          sawTool = true;
          expect(result).toContain("tool path ok");
          return { text: "dispatched", modelId: "t", lane: "fast" };
        }
        return { text: "ok", modelId: "t", lane: "fast" };
      },
    });
    const thread = dog.createThread("tool");
    await dog.send(thread.id, "use cursor tool");
    expect(sawTool).toBe(true);
  });
});
