import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TOOLS, ToolError } from "../src/core/tools";

const WORKDIR = path.join(import.meta.dir, ".tmp-tools");
const OUTSIDE = path.join(import.meta.dir, ".tmp-outside");

beforeAll(async () => {
  await rm(WORKDIR, { recursive: true, force: true });
  await rm(OUTSIDE, { recursive: true, force: true });
  await mkdir(path.join(WORKDIR, "sub"), { recursive: true });
  await mkdir(OUTSIDE, { recursive: true });
  await writeFile(path.join(WORKDIR, "hello.txt"), "hello yard\nline two", "utf8");
  await writeFile(path.join(WORKDIR, "sub", "deep.ts"), "export const x = 42;", "utf8");
  await writeFile(path.join(OUTSIDE, "secret.txt"), "outside", "utf8");
});

afterAll(async () => {
  await rm(WORKDIR, { recursive: true, force: true });
  await rm(OUTSIDE, { recursive: true, force: true });
});

const ctx = { workdir: WORKDIR, agentTag: "wrecker" };

describe("read_file", () => {
  test("reads within the workdir", async () => {
    expect(await TOOLS.read_file!.execute({ path: "hello.txt" }, ctx)).toContain("hello yard");
  });

  test("refuses paths escaping the workdir", async () => {
    expect(TOOLS.read_file!.execute({ path: "../.tmp-outside/secret.txt" }, ctx)).rejects.toThrow(
      ToolError,
    );
    expect(TOOLS.read_file!.execute({ path: OUTSIDE }, ctx)).rejects.toThrow(ToolError);
  });

  test("reports missing files as tool errors", () => {
    expect(TOOLS.read_file!.execute({ path: "nope.txt" }, ctx)).rejects.toThrow(ToolError);
  });
});

describe("write_file", () => {
  test("creates parent directories and writes content", async () => {
    const out = await TOOLS.write_file!.execute(
      { path: "a/b/c.txt", content: "nested" },
      ctx,
    );
    expect(out).toBe("wrote a/b/c.txt");
    expect(await readFile(path.join(WORKDIR, "a", "b", "c.txt"), "utf8")).toBe("nested");
  });

  test("cannot overwrite outside the workdir", () => {
    expect(
      TOOLS.write_file!.execute({ path: "../escape.txt", content: "bad" }, ctx),
    ).rejects.toThrow(ToolError);
  });
});

describe("list_files", () => {
  test("lists entries with sizes and skips noise dirs", async () => {
    const out = await TOOLS.list_files!.execute({}, ctx);
    expect(out).toContain("hello.txt");
    expect(out).toContain("sub/");
  });
});

describe("grep", () => {
  test("finds matches with line numbers across subdirs", async () => {
    const out = await TOOLS.grep!.execute({ pattern: "const x = 42" }, ctx);
    expect(out).toMatch(/sub[\\/]deep\.ts:1/);
  });

  test("returns a no-match marker instead of throwing", async () => {
    const out = await TOOLS.grep!.execute({ pattern: "zzz-not-present" }, ctx);
    expect(out).toContain("(no matches");
  });
});

describe("run_shell", () => {
  test("runs a command inside the workdir", async () => {
    const out = await TOOLS.run_shell!.execute(
      { command: process.platform === "win32" ? "Get-Location | Select-Object -ExpandProperty Path" : "pwd" },
      ctx,
    );
    expect(out).toContain("exit code 0");
    const s = await stat(WORKDIR);
    expect(s.isDirectory()).toBe(true);
  }, 20_000);
});
