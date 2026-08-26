import { describe, expect, test } from "bun:test";
import { prepareSkills } from "../src/core/library";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("prepareSkills", () => {
  test("unknown skill fails with library hint", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-skill-"));
    expect(prepareSkills(["definitely-not-a-real-skill"], workdir)).rejects.toThrow(
      /yarddog skills/,
    );
  });

  test("real skill builds injection block and stages companions", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-skill-"));
    const { injection } = await prepareSkills(
      ["firebase-crashlytics"], // small body (1287 chars), 2 companion files
      workdir,
    );
    expect(injection).toContain("[JOB SKILLS");
    expect(injection).toContain("[SKILL: firebase-crashlytics]");
    expect(injection).toContain("Companion files staged at");
    expect(injection).toContain(".yarddog/staged/firebase-crashlytics");

    // staged files actually exist and are readable
    const stagedDir = path.join(workdir, ".yarddog", "staged", "firebase-crashlytics");
    const entries = await readdir(stagedDir, { recursive: true });
    expect(entries.length).toBeGreaterThan(0);
  }, 20_000);

  test("multiple skills produce multiple blocks", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-skill-"));
    const { injection } = await prepareSkills(
      ["firebase-crashlytics", "firebase-hosting-basics"],
      workdir,
    );
    expect(injection).toContain("[SKILL: firebase-crashlytics]");
    expect(injection).toContain("[SKILL: firebase-hosting-basics]");
  }, 20_000);

  test("empty request short-circuits", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "yd-skill-"));
    const { injection, specs } = await prepareSkills([], workdir);
    expect(injection).toBe("");
    expect(specs).toEqual([]);
  });
});
