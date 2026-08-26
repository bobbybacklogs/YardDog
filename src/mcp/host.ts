import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * McpManager — YardDog's MCP floor.
 *
 * Connects to MCP servers (stdio transport), discovers their tools, and
 * exposes them to the harness under Claude-Code-style prefixed names:
 *
 *   mcp__<server>__<toolname>
 *
 * Servers are declared in .yarddog/config.json under `mcpServers`, mirroring
 * the de-facto standard shape used by Claude Desktop / Cursor / etc., so
 * existing server blocks are drop-in:
 *
 *   "mcpServers": {
 *     "fetch": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] }
 *   }
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ConnectedTool {
  server: string;
  name: string;
  prefixedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const CALL_TIMEOUT_MS = 60_000;

export class McpManager {
  private clients = new Map<string, Client>();
  private toolCache: ConnectedTool[] | null = null;
  private connecting = new Map<string, Promise<void>>();

  constructor(readonly servers: Record<string, McpServerConfig>) {}

  get serverNames(): string[] {
    return Object.keys(this.servers);
  }

  /** Connect (or reuse) one server. Concurrent callers share one handshake. */
  async ensureConnected(serverName: string): Promise<Client> {
    const existing = this.clients.get(serverName);
    if (existing) return existing;

    const inFlight = this.connecting.get(serverName);
    if (inFlight) return inFlight.then(() => this.clients.get(serverName)!);

    const config = this.servers[serverName];
    if (!config) throw new Error(`unknown MCP server "${serverName}"`);

    const connectPromise = (async () => {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env ? { ...config.env } : undefined,
      });
      const client = new Client({ name: "yarddog", version: "0.1.0" });
      await client.connect(transport);
      this.clients.set(serverName, client);
    })();

    this.connecting.set(serverName, connectPromise);
    try {
      await connectPromise;
    } finally {
      this.connecting.delete(serverName);
    }
    return this.clients.get(serverName)!;
  }

  /** Discover tools across all configured servers (cached per generation). */
  async listTools(): Promise<ConnectedTool[]> {
    if (this.toolCache) return this.toolCache;
    const all: ConnectedTool[] = [];
    for (const serverName of this.serverNames) {
      try {
        const client = await this.ensureConnected(serverName);
        const { tools } = await client.listTools(undefined, { timeout: 15_000 });
        for (const t of tools) {
          all.push({
            server: serverName,
            name: t.name,
            prefixedName: `mcp__${serverName}__${t.name}`,
            description: t.description,
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
          });
        }
      } catch {
        // A dead server shouldn't take the whole floor down — skip it.
      }
    }
    this.toolCache = all;
    return all;
  }

  /** Look up one prefixed tool's definition for the model. */
  async findTool(prefixedName: string): Promise<ConnectedTool | undefined> {
    return (await this.listTools()).find((t) => t.prefixedName === prefixedName);
  }

  /** Invoke a prefixed tool; returns concatenated text content. */
  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const tool = await this.findTool(prefixedName);
    if (!tool) return `error: no MCP tool "${prefixedName}"`;
    const client = await this.ensureConnected(tool.server);
    try {
      const result = await client.callTool(
        { name: tool.name, arguments: args },
        undefined,
        { timeout: CALL_TIMEOUT_MS },
      );
      const parts = Array.isArray(result.content)
        ? result.content
            .map((c: { type?: string; text?: string }) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
            .filter(Boolean)
        : [];
      const body = parts.join("\n") || "(empty result)";
      return result.isError ? `error: ${body}` : body.slice(0, 8000);
    } catch (err) {
      return `error: MCP call failed: ${(err as Error).message}`;
    }
  }

  status(): { name: string; connected: boolean; error?: string }[] {
    return this.serverNames.map((name) => ({ name, connected: this.clients.has(name) }));
  }

  /** Close every child process. Best-effort on shutdown. */
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // already gone
      }
    }
    this.clients.clear();
    this.toolCache = null;
  }
}
