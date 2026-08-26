import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { TOOLS, needsApproval } from "../src/core/tools";
import { Computer } from "../src/workspace/computer";

const ROOT = path.join(import.meta.dir, ".tmp-shell");
const WORKDIR = path.join(ROOT, "project");

describe("shell tool glue", () => {
  test("is registered and approval-free", () => {
    expect(TOOLS.shell).toBeDefined();
    expect(needsApproval("shell")).toBe(false);
    expect(needsApproval("run_shell")).toBe(true); // host shell stays gated
  });

  test("executes against the calling agent's computer", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(WORKDIR, { recursive: true });
    const computer = await Computer.create("wrecker", WORKDIR, ROOT);
    const out = await TOOLS.shell!.execute(
      { command: "echo hello > t.txt && cat t.txt" },
      { workdir: WORKDIR, agentTag: "wrecker", computer },
    );
    expect(out).toContain("exit code 0");
    expect(out).toContain("hello");
    // landed in the agent's real workspace dir
    expect(existsSync(path.join(ROOT, "workspaces", "wrecker", "t.txt"))).toBe(true);
  });

  test("fails cleanly when no computer is attached", async () => {
    expect(
      TOOLS.shell!.execute({ command: "echo hi" }, { workdir: WORKDIR, agentTag: "ghost" }),
    ).rejects.toThrow("no computer attached");
  });
});
