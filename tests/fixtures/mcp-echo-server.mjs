// Deterministic MCP stdio server used by YardDog tests.
// Exposes two trivial tools so the host can be tested offline.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "yarddog-test-fixture", version: "0.1.0" });

server.tool("echo", { text: z.string() }, async ({ text }) => ({
  content: [{ type: "text", text: `echo: ${text}` }],
}));

server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }],
}));

await server.connect(new StdioServerTransport());
