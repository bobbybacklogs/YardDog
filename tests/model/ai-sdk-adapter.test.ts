import { describe, expect, test } from "bun:test";
import { AiSdkAdapter } from "../../src/model/ai-sdk-adapter";

function mockStreamText(sequence: Array<"ok" | "restrict" | "fail">) {
  let call = 0;
  return ((_args: unknown) => {
    const outcome = sequence[call++] ?? "fail";
    if (outcome === "restrict") {
      throw new Error("free tier users do not have access to this model");
    }
    if (outcome === "fail") {
      throw new Error("boom");
    }
    return {
      textStream: (async function* () {
        yield "hello ";
        yield "yard";
      })(),
      usage: Promise.resolve({
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      }),
    };
  }) as typeof import("ai").streamText;
}

describe("AiSdkAdapter", () => {
  test("streams a turn without ModelHitch", async () => {
    const adapter = new AiSdkAdapter({
      streamTextFn: mockStreamText(["ok"]),
      laneConfig: { fastPool: ["google/gemini-2.5-flash"] },
    });

    const chunks = [];
    for await (const chunk of adapter.streamTurn({
      messages: [{ role: "user", content: "hi" }],
      lane: "fast",
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({
      type: "lane",
      lane: "fast",
      modelId: "google/gemini-2.5-flash",
    });
    expect(chunks.some((c) => c.type === "text-delta" && c.text === "hello ")).toBe(true);
    const finish = chunks.find((c) => c.type === "finish");
    expect(finish).toMatchObject({
      type: "finish",
      modelId: "google/gemini-2.5-flash",
      lane: "fast",
      text: "hello yard",
    });
  });

  test("failsover to next pool model on restriction errors", async () => {
    const adapter = new AiSdkAdapter({
      streamTextFn: mockStreamText(["restrict", "ok"]),
      laneConfig: {
        fastPool: ["openai/gpt-4o", "google/gemini-2.5-flash"],
      },
    });

    const chunks = [];
    for await (const chunk of adapter.streamTurn({
      messages: [{ role: "user", content: "hi" }],
      lane: "fast",
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "failover")).toBe(true);
    const finish = chunks.find((c) => c.type === "finish");
    expect(finish).toMatchObject({
      type: "finish",
      modelId: "google/gemini-2.5-flash",
    });
  });

  test("completeTurn aggregates text", async () => {
    const adapter = new AiSdkAdapter({
      streamTextFn: mockStreamText(["ok"]),
      laneConfig: { fastPool: ["google/gemini-2.5-flash"] },
    });
    const result = await adapter.completeTurn({
      messages: [{ role: "user", content: "hi" }],
      lane: "fast",
    });
    expect(result.text).toBe("hello yard");
    expect(result.modelId).toBe("google/gemini-2.5-flash");
    expect(result.lane).toBe("fast");
  });
});
