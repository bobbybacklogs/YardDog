import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, historyToMessages, renderRoster } from "../src/core/prompts";
import { defaultCrew } from "../src/core/crew";
import type { ThreadMessage } from "../src/core/types";

const crew = defaultCrew();

describe("renderRoster", () => {
  test("marks self", () => {
    const roster = renderRoster(crew, "wrecker");
    expect(roster).toContain("@foreman — chief of staff");
    expect(roster).toContain("@wrecker — coder — writes and fixes code, runs builds and tests (you)");
  });
});

describe("buildSystemPrompt", () => {
  test("includes persona, memory, roster and protocol", () => {
    const wrecker = crew.find((a) => a.tag === "wrecker")!;
    const prompt = buildSystemPrompt({ ...wrecker, memory: "prefers bun over npm" }, crew);
    expect(prompt).toContain("@wrecker");
    expect(prompt).toContain("[PERSISTENT MEMORY");
    expect(prompt).toContain("prefers bun over npm");
    expect(prompt).toContain("[TEAM ROSTER]");
    expect(prompt).toContain("[TEAMWORK PROTOCOL]");
    expect(prompt).toContain("@delegate(to:");
    expect(prompt).toContain("@escalate(");
  });

  test("names the delegator as a no-return target", () => {
    const mule = crew.find((a) => a.tag === "mule")!;
    const prompt = buildSystemPrompt(mule, crew, "foreman");
    expect(prompt).toContain("Never delegate back to @foreman");
  });
});

describe("historyToMessages", () => {
  test("own messages become assistant turns, others labeled user turns", () => {
    const history: ThreadMessage[] = [
      { id: "1", from: "user", text: "fix it", ts: 1, depth: 0 },
      { id: "2", from: "spotter", text: "found it in src/a.ts", ts: 2, depth: 0 },
      { id: "3", from: "wrecker", text: "fixed", ts: 3, depth: 0 },
    ];
    const msgs = historyToMessages(history, "wrecker");
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "user", content: "[from user] fix it" });
    expect(msgs[1]).toEqual({
      role: "user",
      content: "[from @spotter] found it in src/a.ts",
    });
    expect(msgs[2]).toEqual({ role: "assistant", content: "fixed" });
  });

  test("window keeps only the tail", () => {
    const history: ThreadMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      from: "user",
      text: `msg ${i}`,
      ts: i,
      depth: 0,
    }));
    const msgs = historyToMessages(history, "wrecker", 24);
    expect(msgs).toHaveLength(24);
    expect(msgs[0]!.content).toContain("msg 6");
    expect(msgs.at(-1)!.content).toContain("msg 29");
  });
});
