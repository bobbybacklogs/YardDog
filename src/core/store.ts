import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentDef, Thread } from "./types";

/**
 * JSON persistence under `<workdir>/.yarddog/`:
 *   agents.json      — the crew
 *   config.json      — harness settings
 *   threads/<id>.json — one file per thread
 */

export interface HarnessConfig {
  /** Provider/model used for crew members that don't override their lane. */
  provider: string;
  model: string;
  /** Orchestration depth cap (default 3). */
  maxDepth: number;
  /** Auto-approve heavy tools (write_file, run_shell) without prompting. */
  autoApproveTools: boolean;
}

export const DEFAULT_CONFIG: HarnessConfig = {
  provider: "opencode-zen",
  model: "deepseek-v4-flash-free",
  maxDepth: 3,
  autoApproveTools: false,
};

export class Store {
  /** The user's project directory — all agent tool work happens here. */
  readonly workdir: string;
  /** Persistence root: <workdir>/.yarddog */
  readonly dir: string;
  private readonly threadsDir: string;

  constructor(workdir: string) {
    this.workdir = path.resolve(workdir);
    this.dir = path.join(this.workdir, ".yarddog");
    this.threadsDir = path.join(this.dir, "threads");
  }

  async init(): Promise<void> {
    await mkdir(this.threadsDir, { recursive: true });
    if (!(await this.exists(path.join(this.dir, "config.json")))) {
      await this.saveConfig(DEFAULT_CONFIG);
    }
  }

  private async exists(file: string): Promise<boolean> {
    return readFile(file, "utf8").then(
      () => true,
      () => false,
    );
  }

  async loadConfig(): Promise<HarnessConfig> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir, "config.json"), "utf8"));
      return { ...DEFAULT_CONFIG, ...raw };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(config: HarnessConfig): Promise<void> {
    await writeFile(
      path.join(this.dir, "config.json"),
      JSON.stringify(config, null, 2) + "\n",
      "utf8",
    );
  }

  async loadCrew(): Promise<AgentDef[] | null> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir, "agents.json"), "utf8"));
      return Array.isArray(raw) ? (raw as AgentDef[]) : null;
    } catch {
      return null;
    }
  }

  async saveCrew(crew: AgentDef[]): Promise<void> {
    await writeFile(path.join(this.dir, "agents.json"), JSON.stringify(crew, null, 2) + "\n", "utf8");
  }

  async saveThread(thread: Thread): Promise<void> {
    await writeFile(
      path.join(this.threadsDir, `${thread.id}.json`),
      JSON.stringify(thread, null, 2) + "\n",
      "utf8",
    );
  }

  async loadThreads(): Promise<Thread[]> {
    try {
      const files = (await readdirSafe(this.threadsDir)).filter((f) => f.endsWith(".json"));
      const threads: Thread[] = [];
      for (const f of files) {
        try {
          threads.push(JSON.parse(await readFile(path.join(this.threadsDir, f), "utf8")) as Thread);
        } catch {
          // skip corrupt thread files rather than failing the whole load
        }
      }
      return threads.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}
