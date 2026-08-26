import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { McpManager } from "../src/mcp/host";

const FIXTURE = path.join(import.meta.dir, "fixtures", "mcp-echo-server.mjs");
const manager = new McpManager({
  fixture: { command: "bun", args: [FIXTURE] },
});

afterAll(async () => {
  await manager.shutdown();
});

describe("McpManager", () => {
  test("connects and discovers tools with prefixed names", async () => {
    const tools = await manager.listTools();
    const names = tools.map((t) => t.prefixedName).sort();
    expect(names).toEqual(["mcp__fixture__add", "mcp__fixture__echo"]);
    for (const t of tools) {
      expect(t.server).toBe("fixture");
      expect(t.inputSchema).toBeTruthy();
    }
  });

  test("invokes a tool by prefixed name", async () => {
    const out = await manager.callTool("mcp__fixture__echo", { text: "yard" });
    expect(out).toBe("echo: yard");
  });

  test("passes structured arguments", async () => {
    const out = await manager.callTool("mcp__fixture__add", { a: 19, b: 23 });
    expect(out).toBe("42");
  });

  test("unknown tools fail with a clean error string", async () => {
    const out = await manager.callTool("mcp__fixture__nope", {});
    expect(out).toContain("no MCP tool");
  });

  test("status reflects connections", async () => {
    await manager.listTools(); // ensure connect
    const s = manager.status();
    expect(s).toEqual([{ name: "fixture", connected: true }]);
  });
});
