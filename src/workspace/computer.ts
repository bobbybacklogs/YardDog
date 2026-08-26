import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs } from "just-bash";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * A Computer — one agent's private sandbox, the YardDog answer to "every
 * bot has its own cloud box". Backed by just-bash running in-process:
 *
 *   /home/<tag>   → private workspace, persisted to .yarddog/workspaces/<tag>/
 *   /project      → the user's real repo, READ-ONLY (writes throw EROFS)
 *
 * Bun note: defenseInDepth is disabled — it relies on node:module
 * registerHooks, which Bun does not implement. Isolation here comes from the
 * filesystem layer: home writes land on disk under .yarddog/, and /project is
 * a read-only overlay over the real workdir.
 */

export interface ComputerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class Computer {
  readonly tag: string;
  readonly bash: Bash;

  private constructor(tag: string, bash: Bash) {
    this.tag = tag;
    this.bash = bash;
  }

  /**
   * Build a computer for an agent.
   * @param tag        agent handle (also the home dir name)
   * @param workdir    the user's real project directory → /project (read-only)
   * @param stateDir   harness state dir (.yarddog) → homes live under workspaces/
   */
  static async create(tag: string, workdir: string, stateDir: string): Promise<Computer> {
    const homeReal = path.join(stateDir, "workspaces", tag);
    await mkdir(homeReal, { recursive: true });

    const fs = new MountableFs({ base: new InMemoryFs() });
    fs.mount("/project", new OverlayFs({ root: workdir, readOnly: true, mountPoint: "/" }));
    fs.mount(`/home/${tag}`, new ReadWriteFs({ root: homeReal }));

    const bash = new Bash({
      fs,
      cwd: `/home/${tag}`,
      env: {
        AGENT: tag,
        PROJECT: "/project",
        WORKSPACE: `/home/${tag}`,
      },
      executionLimits: { maxExecutionTimeMs: 30_000 },
      defenseInDepth: { enabled: false },
    });

    return new Computer(tag, bash);
  }

  /** Run a command; never throws — failures come back as results. */
  async run(command: string): Promise<ComputerRunResult> {
    try {
      const r = await this.bash.exec(command);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    } catch (err) {
      // e.g. writing to the read-only project mount throws EROFS instead of
      // returning an exit code — normalize it into a shell-style failure.
      return {
        stdout: "",
        stderr: `sandbox error: ${(err as Error).message}`,
        exitCode: 126,
      };
    }
  }
}
