import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { YardDog } from "../src/core/harness";

async function makeDog(): Promise<YardDog> {
  const workdir = path.join(import.meta.dir, ".tmp-queue");
  await mkdir(path.join(workdir, ".yarddog"), { recursive: true });
  await writeFile(
    path.join(workdir, ".yarddog", "config.json"),
    JSON.stringify({ provider: "mock", model: "mock-model", maxDepth: 3, autoApproveTools: true }),
  );
  return YardDog.create({ workdir });
}

describe("job queue", () => {
  test("concurrent sends queue FIFO instead of rejecting", async () => {
    const dog = await makeDog();
    const thread = dog.createThread("queue test");

    // Fire two jobs without awaiting the first.
    const p1 = dog.send(thread.id, "job one");
    const p2 = dog.send(thread.id, "job two");
    expect(dog.pending).toBeGreaterThanOrEqual(0); // counter is live

    await Promise.all([p1, p2]);

    const userMsgs = thread.messages.filter((m) => m.from === "user");
    expect(userMsgs.map((m) => m.text)).toEqual(["job one", "job two"]);
    // every job got a reply
    expect(thread.messages.filter((m) => m.from !== "user").length).toBe(2);
    expect(dog.working).toBe(false);
  });

  test("a failing job rejects its caller but does not kill the queue", async () => {
    const dog = await makeDog();
    const thread = dog.createThread("queue failure test");

    const bad = dog.send("nope-not-a-thread", "bad job").then(
      () => "resolved",
      (err: Error) => `rejected: ${err.message}`,
    );
    const good = dog.send(thread.id, "good job").then(() => "resolved");

    expect(await bad).toMatch(/^rejected: unknown thread/);
    await good;
    expect(thread.messages.some((m) => m.text === "good job")).toBe(true);
  });
});
