import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostedYardDog } from "../src/core/hosted-harness";

async function makeDog(
  replies: Record<string, string[]>,
  config?: { autoApproveTools?: boolean; maxDepth?: number },
) {
  const workdir = await mkdtemp(path.join(tmpdir(), "hosted-yarddog-"));
  const queues = new Map(Object.entries(replies).map(([k, v]) => [k, [...v]]));
  const dog = await HostedYardDog.create({
    workdir,
    config: { autoApproveTools: true, maxDepth: 3, ...config },
    runModelTurn: async ({ agent }) => {
      const q = queues.get(agent.tag) ?? [];
      const text = q.shift() ?? `(${agent.tag} done)`;
      return { text, modelId: "test-model", lane: "fast" };
    },
  });
  return { dog, workdir };
}

describe("HostedYardDog Phase 2", () => {
  test("runs @delegate handoffs without ModelHitch", async () => {
    const { dog } = await makeDog({
      foreman: ["Plan.\n@delegate(to: @wrecker, task: fix imports)"],
      wrecker: ["Imports fixed."],
    });
    const thread = dog.createThread("delegate");
    await dog.send(thread.id, "fix the imports");
    const msgs = dog.getThread(thread.id)!.messages;
    expect(msgs.some((m) => m.from === "wrecker" && m.text.includes("Imports fixed"))).toBe(true);
    expect(msgs.some((m) => m.handoffs?.some((h) => h.to === "wrecker"))).toBe(true);
  });

  test("runs @consult then continues the asker", async () => {
    const { dog } = await makeDog({
      foreman: [
        "Need a look.\n@consult(to: @spotter, question: where is auth?)",
        "Got it — auth is covered.",
      ],
      spotter: ["Auth is in src/auth.ts"],
    });
    const thread = dog.createThread("consult");
    await dog.send(thread.id, "check auth");
    const texts = dog.getThread(thread.id)!.messages.map((m) => m.text);
    expect(texts.some((t) => t.includes("Auth is in src/auth.ts"))).toBe(true);
    expect(texts.some((t) => t.includes("auth is covered"))).toBe(true);
  });

  test("@escalate stops the chain and sets presence", async () => {
    const { dog } = await makeDog({
      foreman: [
        "Unsure.\n@delegate(to: @wrecker, task: delete prod)\n@escalate(should we delete prod?)",
      ],
      wrecker: ["should never run"],
    });
    const thread = dog.createThread("escalate");
    await dog.send(thread.id, "dangerous ask");
    const msgs = dog.getThread(thread.id)!.messages;
    expect(msgs.some((m) => m.escalation?.question.includes("delete prod"))).toBe(true);
    expect(msgs.some((m) => m.from === "wrecker")).toBe(false);
    expect(dog.getPresence("foreman")).toBe("escalated");
  });

  test("parallel delegates fan out", async () => {
    const { dog } = await makeDog({
      foreman: [
        [
          "Split work.",
          "@delegate(to: @wrecker, task: code)",
          "@delegate(to: @mule, task: docs)",
        ].join("\n"),
      ],
      wrecker: ["code done"],
      mule: ["docs done"],
    });
    const thread = dog.createThread("parallel");
    await dog.send(thread.id, "do both");
    const from = new Set(dog.getThread(thread.id)!.messages.map((m) => m.from));
    expect(from.has("wrecker")).toBe(true);
    expect(from.has("mule")).toBe(true);
  });

  test("remember persists house-crew memory via tools + approval", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "hosted-mem-"));
    const dog = await HostedYardDog.create({
      workdir,
      config: { autoApproveTools: false },
      runModelTurn: async ({ agent, toolNames, executeTool }) => {
        if (agent.tag === "foreman" && toolNames.includes("remember")) {
          await executeTool("remember", {
            note: "user prefers short answers",
            mode: "append",
          });
        }
        return { text: "Noted.", modelId: "t", lane: "fast" };
      },
    });
    dog.approveTool = async (_tag, name) => name === "remember";
    const thread = dog.createThread("mem");
    await dog.send(thread.id, "remember my preference");
    expect(dog.agent("foreman")!.memory).toContain("user prefers short answers");

    const saved = JSON.parse(await readFile(path.join(workdir, ".yarddog", "agents.json"), "utf8"));
    const foreman = saved.find((a: { tag: string }) => a.tag === "foreman");
    expect(foreman.memory).toContain("user prefers short answers");
  });

  test("heavy tools are blocked when approval declines", async () => {
    const { dog } = await makeDog(
      {
        wrecker: ["attempt write"],
      },
      { autoApproveTools: false },
    );
    // Force wrecker via mention; inject tool call in runModelTurn override after create
    const workdir = await mkdtemp(path.join(tmpdir(), "hosted-deny-"));
    const dog2 = await HostedYardDog.create({
      workdir,
      config: { autoApproveTools: false },
      runModelTurn: async ({ executeTool, toolNames }) => {
        if (toolNames.includes("write_file")) {
          const result = await executeTool("write_file", {
            path: "secret.txt",
            content: "nope",
          });
          return { text: result, modelId: "t", lane: "fast" };
        }
        return { text: "no tools", modelId: "t", lane: "fast" };
      },
    });
    dog2.approveTool = async () => false;
    const thread = dog2.createThread("deny");
    await dog2.send(thread.id, "@wrecker write a file");
    const wreckerMsg = dog2
      .getThread(thread.id)!
      .messages.find((m) => m.from === "wrecker");
    expect(wreckerMsg?.text.toLowerCase()).toContain("declined");
    void dog;
  });
});
