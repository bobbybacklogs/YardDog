import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Smoke test: the TUI must actually come up.
 *
 * Regression guard for the classic failure mode where a render-path throw
 * (here: iterating a non-array getChildren() result) killed the whole app
 * right after renderer init — a "cleared screen with a prompt that does
 * nothing". The app is spawned exactly like a user would run it; if it
 * exits early, we fail with whatever stderr it produced.
 */
describe("tui smoke", () => {
  test("launches and stays alive", async () => {
    const workdir = path.join(import.meta.dir, ".tmp-tui");
    await rm(workdir, { recursive: true, force: true });
    await mkdir(path.join(workdir, ".yarddog"), { recursive: true });
    const modelHitchHome = path.join(workdir, ".modelhitch");
    await mkdir(modelHitchHome, { recursive: true });
    await writeFile(
      path.join(workdir, ".yarddog", "config.json"),
      JSON.stringify({ maxDepth: 3, autoApproveTools: true }),
    );
    await writeFile(
      path.join(modelHitchHome, "config.json"),
      JSON.stringify({ version: 1, defaultProviderId: "mock", defaultModel: "mock-model" }),
    );

    const proc = Bun.spawn({
      cmd: [process.execPath, path.join(import.meta.dir, "..", "src", "cli.ts"), "tui"],
      cwd: workdir,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, MODELHITCH_HOME: modelHitchHome, TERM: "dumb" },
    });

    // Give it a generous window to mount the renderer and render initial state.
    await Bun.sleep(4000);

    const alive = proc.exitCode === null;
    if (alive) proc.kill();
    const errText = await new Response(proc.stderr).text();

    expect(alive).toBe(true);
    expect(errText).not.toContain("FATAL");
    expect(errText).not.toMatch(/TypeError|ReferenceError|SyntaxError/);

    await rm(workdir, { recursive: true, force: true });
  }, 20_000);
});
