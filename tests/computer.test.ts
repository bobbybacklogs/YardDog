import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Computer } from "../src/workspace/computer";

const ROOT = path.join(import.meta.dir, ".tmp-computer");
const WORKDIR = path.join(ROOT, "project");
const STATEDIR = path.join(ROOT, "state");

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(path.join(WORKDIR, "src"), { recursive: true });
  writeFileSync(path.join(WORKDIR, "README.md"), "# the yard\n");
  writeFileSync(path.join(WORKDIR, "src", "main.ts"), "export const x = 1;\n");
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("Computer", () => {
  test("private home is writable and persists to real disk", async () => {
    const c = await Computer.create("wrecker", WORKDIR, STATEDIR);
    const r = await c.run("echo notes > notes.txt && cat notes.txt");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("notes");
    // durability: landed in .yarddog/workspaces/wrecker on the real fs
    expect(
      existsSync(path.join(STATEDIR, "workspaces", "wrecker", "notes.txt")),
    ).toBe(true);
  });

  test("home persists across separate Computer instances (same agent)", async () => {
    const first = await Computer.create("mule", WORKDIR, STATEDIR);
    await first.run("echo draft-v1 > doc.md");
    const second = await Computer.create("mule", WORKDIR, STATEDIR);
    const r = await second.run("cat /home/mule/doc.md");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("draft-v1");
  });

  test("/project is readable", async () => {
    const c = await Computer.create("spotter", WORKDIR, STATEDIR);
    const r = await c.run("cat /project/README.md && grep -r 'export' /project/src/");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("the yard");
    expect(r.stdout).toContain("export const x = 1");
  });

  test("/project writes fail without throwing (EROFS normalized)", async () => {
    const c = await Computer.create("spotter", WORKDIR, STATEDIR);
    const r = await c.run("echo hacked > /project/README.md");
    expect(r.exitCode).not.toBe(0);
    // the real file is untouched
    expect(readFileSync(path.join(WORKDIR, "README.md"), "utf8")).toBe("# the yard\n");
  });

  test("agents are isolated from each other", async () => {
    const a = await Computer.create("agent-a", WORKDIR, STATEDIR);
    const b = await Computer.create("agent-b", WORKDIR, STATEDIR);
    await a.run("echo secret-a > private.txt");
    const r = await b.run("cat /home/agent-a/private.txt");
    expect(r.exitCode).not.toBe(0); // agent-b cannot see agent-a's files
    // ...and cannot even list another agent's home
    const ls = await b.run("ls /home/agent-a");
    expect(ls.stdout).not.toContain("private.txt");
  });

  test("runaway commands are killed at the wall-clock limit", async () => {
    const c = await Computer.create("slowpoke", WORKDIR, STATEDIR);
    const r = await c.run("while true; do true; done");
    expect(r.exitCode).not.toBe(0);
  }, 45_000);

  test("env vars expose identity and layout", async () => {
    const c = await Computer.create("foreman", WORKDIR, STATEDIR);
    const r = await c.run("echo $AGENT $PROJECT $WORKSPACE");
    expect(r.stdout.trim()).toBe("foreman /project /home/foreman");
  });
});
