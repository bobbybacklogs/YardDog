import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ModelHitch, type Provider } from "modelhitch";
import type { ChatParams, ChatResult, StreamChunk } from "modelhitch";
import { YardDog } from "../src/core/harness";

describe("ModelHitch routing ownership", () => {
  test("YardDog leaves provider and model selection to ModelHitch", async () => {
    const seenModels: string[] = [];
    const provider: Provider = {
      id: "routing-owner",
      name: "Routing owner",
      defaultModel: "modelhitch-selected-model",
      capabilities: { streaming: true, toolCalling: true, vision: false, embeddings: false },
      async chat(params: ChatParams): Promise<ChatResult> {
        seenModels.push(params.model);
        return { message: { role: "assistant", content: "routed" }, finishReason: "stop" };
      },
      async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
        seenModels.push(params.model);
        yield { type: "text-delta", text: "routed" };
        yield { type: "finish", finishReason: "stop" };
      },
    };
    const workdir = path.join(import.meta.dir, ".tmp-routing");
    await rm(workdir, { recursive: true, force: true });
    await mkdir(workdir, { recursive: true });

    const dog = await YardDog.create({
      workdir,
      modelHitch: new ModelHitch({ providers: [provider], defaultProviderId: provider.id }),
    });
    const thread = dog.createThread("routing test");
    await dog.send(thread.id, "who owns the lane?");

    expect(seenModels).toEqual(["modelhitch-selected-model"]);
    expect(dog.agents.every((agent) => !("provider" in agent) && !("model" in agent))).toBe(true);
    const yardDogConfig = JSON.parse(
      await readFile(path.join(workdir, ".yarddog", "config.json"), "utf8"),
    );
    expect(yardDogConfig).not.toHaveProperty("provider");
    expect(yardDogConfig).not.toHaveProperty("model");
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

    const modelHitch = new ModelHitch({ defaultProviderId: "mock", defaultModel: "mock-model" });
    const first = await YardDog.create({ workdir, modelHitch });
    const legacyCrew = first.agents.map((agent) => ({
      ...agent,
      provider: "opencode-zen",
      model: "deepseek-v4-flash-free",
    }));
    await writeFile(path.join(yardDogDir, "agents.json"), JSON.stringify(legacyCrew));

    await YardDog.create({ workdir, modelHitch });

    const config = JSON.parse(await readFile(path.join(yardDogDir, "config.json"), "utf8"));
    const crew = JSON.parse(await readFile(path.join(yardDogDir, "agents.json"), "utf8"));
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model");
    expect(crew.every((agent: Record<string, unknown>) => !("provider" in agent) && !("model" in agent))).toBe(true);
  });
});