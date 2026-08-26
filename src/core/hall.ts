import { discoverAgents, type AgentSpec } from "portage-cli";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { TOOLS } from "./tools";
import type { AgentDef } from "./types";

/**
 * The hiring hall — turns verified local agent definitions (via portage)
 * into YardDog temp workers.
 *
 * Temps are session-scoped: they join the runtime roster so house agents can
 * @delegate and @consult them like anyone else, but they are never persisted
 * to agents.json. When the session ends, they clock out.
 */

/**
 * Superset of portage's defaultAgentRoots(): the published 0.1.4 default list
 * misses ~/.copilot/agents even though it is a documented user root. We pass
 * our own roots explicitly so discovery never depends on upstream defaults.
 */
export async function tempRoots(projectRoot?: string): Promise<string[]> {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) return [];
  const ancestors: string[] = [];
  if (projectRoot) {
    let dir = path.resolve(projectRoot);
    while (true) {
      ancestors.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const roots: string[] = [];
  for (const base of [...ancestors, home]) {
    for (const vendor of [".agents", ".claude", ".codex", ".github", ".gemini", ".cursor", ".opencode", ".copilot"]) {
      roots.push(path.join(base, vendor, "agents"));
    }
  }
  return roots;
}

export function slugifyTag(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "temp";
}

/** Vendor tool names → YardDog tool names. Unmapped tools are dropped (receipt notes why). */
export function mapTools(vendorTools: string[] | undefined): { tools: string[]; dropped: string[] } {
  if (!vendorTools || vendorTools.length === 0) return { tools: [], dropped: [] };
  const MAP: Record<string, string> = {
    read: "read_file",
    search: "grep",
    edit: "write_file",
    execute: "run_shell",
    "execute/runinterminal": "run_shell",
    "execute/getterminaloutput": "run_shell",
    list: "list_files",
  };
  const tools = new Set<string>();
  const dropped: string[] = [];
  for (const raw of vendorTools) {
    const mapped = MAP[raw.toLowerCase()];
    if (mapped && TOOLS[mapped]) {
      tools.add(mapped);
    } else {
      dropped.push(raw);
    }
  }
  return { tools: [...tools], dropped };
}

export interface HireResult {
  def: AgentDef;
  /** Tools that existed in the source spec but have no YardDog equivalent. */
  droppedTools: string[];
  /** Notes about anything lost or adjusted in translation. */
  notes: string[];
}

export function specToTempDef(spec: AgentSpec): HireResult {
  const notes: string[] = [];
  const tag = slugifyTag(spec.name);
  if (tag !== spec.name.toLowerCase()) {
    notes.push(`name "${spec.name}" hired as tag "${tag}"`);
  }

  const { tools, dropped } = mapTools(spec.tools);
  if (dropped.length > 0) {
    notes.push(`no yarddog equivalent for tools: ${dropped.join(", ")}`);
  }

  // Model lanes: v1 honors explicit provider/model pairs only; vendor
  // shorthand ('inherit', 'sonnet', 'flash') falls back to the config lane.
  let provider = "";
  let model = "";
  const m = spec.model;
  if (m && m !== "inherit" && m.includes("/")) {
    const idx = m.indexOf("/");
    provider = m.slice(0, idx);
    model = m.slice(idx + 1);
  } else if (m && m !== "inherit") {
    notes.push(`model "${m}" not resolvable — riding the default config lane`);
  }

  return {
    def: {
      id: `temp-${randomUUID().slice(0, 8)}`,
      tag,
      name: spec.name,
      role: spec.description?.slice(0, 120) || "hired temp worker",
      description: spec.description,
      systemPrompt: spec.body,
      provider,
      model,
      memory: "",
      tools,
      temp: {
        vendor: spec.provenance?.vendor ?? "unknown",
        sourcePath: spec.provenance?.path ?? spec.configFile ?? "",
        hiredAt: Date.now(),
      },
    },
    droppedTools: dropped,
    notes,
  };
}

export interface TempListing {
  tag: string;
  name: string;
  vendor: string;
  description: string;
  path: string;
}

export async function discoverTemps(projectRoot?: string): Promise<TempListing[]> {
  const roots = await tempRoots(projectRoot);
  const specs = await discoverAgents(roots);
  return specs.map((s) => ({
    tag: slugifyTag(s.name),
    name: s.name,
    vendor: s.provenance?.vendor ?? "unknown",
    description: s.description ?? "",
    path: s.provenance?.path ?? s.configFile ?? "",
  }));
}
