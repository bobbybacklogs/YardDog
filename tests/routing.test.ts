import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { YardDog } from "../src/core/harness";

describe("YardDog lane ownership (Phase 3)", () => {
  test("YardDog leaves provider/model off agents; lanes come from adapter turn", async () => {
    const seenModels: string[] = [];
    const workdir = path.join(import.meta.dir, ".tmp-routing");
    await rm(workdir, { recursive: true, force: true });
    await mkdir(workdir, { recursive: true });

    const dog = await YardDog.create({
      workdir,
      runModelTurn: async ({ agent }) => {
        seenModels.push("yarddog-lane-model");
        return { text: `routed by ${agent.tag}`, modelId: "yarddog-lane-model", lane: "fast" };
      },
    });
    const thread = dog.createThread("routing test");
    await dog.send(thread.id, "who owns the lane?");

    expect(seenModels).toEqual(["yarddog-lane-model"]);
    expect(dog.agents.every((agent) => !("provider" in agent) && !("model" in agent))).toBe(true);
    const yardDogConfig = JSON.parse(
      await readFile(path.join(workdir, ".yarddog", "config.json"), "utf8"),
    );
    expect(yardDogConfig).not.toHaveProperty("provider");
    expect(yardDogConfig).not.toHaveProperty("model");
  });

  test("lane pool failover is reported via onFailover / failedOver meta", async () => {
    const workdir = path.join(import.meta.dir, ".tmp-capability-routing");
    await rm(workdir, { recursive: true, force: true });
    await mkdir(workdir, { recursive: true });

    let attempts = 0;
    const dog = await YardDog.create({
      workdir,
      runModelTurn: async ({ onFailover }) => {
        attempts++;
        if (attempts === 1) {
          onFailover?.();
          return {
            text: "served via failover lane",
            modelId: "fast-fallback",
            lane: "fast",
            failedOver: true,
          };
        }
        return { text: "ok", modelId: "fast-primary", lane: "fast" };
      },
    });
    const thread = dog.createThread("failover routing test");
    await dog.send(thread.id, "use the capable lane");

    expect(attempts).toBe(1);
    expect(thread.messages.some((m) => m.text === "served via failover lane")).toBe(true);
    expect(thread.messages.some((m) => m.meta?.failedOver === true)).toBe(true);
  });

  test("legacy YardDog lane fields are removed from persisted state", async () => {
    const workdir = path.join(import.meta.dir, ".tmp-routing-migration");
    const yardDogDir = path.join(workdir, ".yarddog");
    await rm(workdir, { recursive: true, force: true });
    await mkdir(yardDogDir, { recursive: true });
    await writeFile(
      path.join(yardDogDir, "config.json"),
      JSON.stringify({
        provider: "opencode-zen",
        model: "deepseek-v4-flash-free",
        maxDepth: 3,
        autoApproveTools: false,
      }),
    );

    const first = await YardDog.create({
      workdir,
      runModelTurn: async () => ({ text: "noop", modelId: "t", lane: "fast" }),
    });
    const legacyCrew = first.agents.map((agent) => ({
      ...agent,
      provider: "opencode-zen",
      model: "deepseek-v4-flash-free",
    }));
    await writeFile(path.join(yardDogDir, "agents.json"), JSON.stringify(legacyCrew));

    await YardDog.create({
      workdir,
      runModelTurn: async () => ({ text: "noop", modelId: "t", lane: "fast" }),
    });

    const config = JSON.parse(await readFile(path.join(yardDogDir, "config.json"), "utf8"));
    const crew = JSON.parse(await readFile(path.join(yardDogDir, "agents.json"), "utf8"));
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model");
    expect(crew.every((agent: Record<string, unknown>) => !("provider" in agent) && !("model" in agent))).toBe(true);
  });
});
