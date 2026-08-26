import { spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "modelhitch";

/**
 * Built-in tool registry. Every tool is workdir-confined: paths resolve
 * against the harness workdir and escapes are refused. `run_shell` is the
 * heavy hauler — it goes through the approval gate unless explicitly waived.
 */

export interface ToolContext {
  /** Absolute working directory all tool operations are confined to. */
  workdir: string;
  agentTag: string;
}

export interface ToolSpec {
  def: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolError extends Error {}

function resolveInWorkdir(ctx: ToolContext, raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ToolError("`path` must be a non-empty relative path");
  }
  const abs = path.resolve(ctx.workdir, raw);
  const rel = path.relative(ctx.workdir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ToolError(`path escapes the workdir: ${raw}`);
  }
  return abs;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new ToolError(`\`${key}\` must be a string`);
  return v;
}

const read_file: ToolSpec = {
  def: {
    name: "read_file",
    description:
      "Read a text file inside the workdir. Returns the full contents. Fails if the file does not exist.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative file path" } },
      required: ["path"],
    },
  },
  async execute(args, ctx) {
    const abs = resolveInWorkdir(ctx, args.path);
    try {
      return await readFile(abs, "utf8");
    } catch (err) {
      throw new ToolError(`cannot read ${args.path}: ${(err as Error).message}`);
    }
  },
};

const write_file: ToolSpec = {
  def: {
    name: "write_file",
    description:
      "Create or overwrite a text file inside the workdir with the given content. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full file contents to write" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args, ctx) {
    const abs = resolveInWorkdir(ctx, args.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, str(args, "content"), "utf8");
    return `wrote ${args.path}`;
  },
};

const list_files: ToolSpec = {
  def: {
    name: "list_files",
    description:
      "List files and directories under a workdir-relative directory (default: the workdir root). Not recursive.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory (optional)" },
      },
    },
  },
  async execute(args, ctx) {
    const abs = resolveInWorkdir(ctx, typeof args.path === "string" && args.path ? args.path : ".");
    const entries = await readdir(abs, { withFileTypes: true });
    if (entries.length === 0) return "(empty)";
    const lines: string[] = [];
    for (const entry of entries) {
      if (entry.name === ".yarddog" || entry.name === "node_modules") continue;
      let suffix = "";
      if (entry.isDirectory()) suffix = "/";
      else if (entry.isFile()) {
        const size = (await stat(path.join(abs, entry.name))).size;
        suffix = ` (${size} bytes)`;
      }
      lines.push(`${entry.name}${suffix}`);
    }
    return lines.join("\n");
  },
};

const grep_files: ToolSpec = {
  def: {
    name: "grep",
    description:
      "Search file contents under a workdir-relative directory for a literal string. Returns matching file paths with line numbers and a preview.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text to search for" },
        path: { type: "string", description: "Relative directory (default workdir root)" },
      },
      required: ["pattern"],
    },
  },
  async execute(args, ctx) {
    const pattern = str(args, "pattern");
    const base = resolveInWorkdir(
      ctx,
      typeof args.path === "string" && args.path ? args.path : ".",
    );
    const needle = pattern.toLowerCase();
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (results.length >= 50) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (results.length >= 50) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".yarddog" || entry.name === ".git") continue;
          await walk(full);
        } else if (entry.isFile()) {
          let content: string;
          try {
            content = await readFile(full, "utf8");
          } catch {
            continue; // binary or unreadable
          }
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.toLowerCase().includes(needle)) {
              results.push(`${path.relative(ctx.workdir, full)}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`);
              if (results.length >= 50) return;
            }
          }
        }
      }
    };
    await walk(base);
    return results.length > 0 ? results.join("\n") : `(no matches for "${pattern}")`;
  },
};

const run_shell: ToolSpec = {
  def: {
    name: "run_shell",
    description:
      "Run a shell command in the workdir (bash on POSIX, powershell on Windows). Returns stdout/stderr. Use for builds, tests, git status — not for interactive commands.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
      },
      required: ["command"],
    },
  },
  async execute(args, ctx) {
    const command = str(args, "command");
    return new Promise<string>((resolve) => {
      const isWin = process.platform === "win32";
      const child = spawn(isWin ? "powershell" : "bash", isWin ? ["-NoProfile", "-Command", command] : ["-c", command], {
        cwd: ctx.workdir,
        env: process.env,
      });
      let out = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(out.slice(0, 8000) + "\n(command killed after 120s timeout)");
      }, 120_000);
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(`spawn failed: ${err.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const body = out.trim().slice(0, 8000);
        resolve(`exit code ${code}${body ? `\n${body}` : ""}`);
      });
    });
  },
};

export const TOOLS: Record<string, ToolSpec> = {
  read_file,
  write_file,
  list_files,
  grep: grep_files,
  run_shell,
};

/** Tools that never need human approval. */
const SAFE_TOOLS = new Set(["read_file", "list_files", "grep"]);

export function needsApproval(name: string): boolean {
  return !SAFE_TOOLS.has(name);
}
