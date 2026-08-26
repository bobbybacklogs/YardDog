import { describe, expect, test } from "bun:test";
import { parseReply } from "../src/core/directives";
import { mapTools, slugifyTag, specToTempDef } from "../src/core/hall";
import type { AgentSpec } from "portage-cli";

describe("consult directive", () => {
  test("parses and strips @consult", () => {
    const raw = "Need a call here.\n@consult(to: @foreman, question: pg or sqlite?)";
    const out = parseReply(raw, "wrecker");
    expect(out.clean).toBe("Need a call here.");
    expect(out.consult).toEqual({ from: "wrecker", to: "foreman", question: "pg or sqlite?" });
    expect(out.handoffs).toEqual([]);
    expect(out.escalation).toBeUndefined();
  });

  test("escalation outranks consult", () => {
    const raw = [
      "Two ways.",
      "@consult(to: @foreman, question: which way?)",
      "@escalate(this touches billing)",
    ].join("\n");
    const out = parseReply(raw, "mule");
    expect(out.consult).toBeUndefined();
    expect(out.escalation?.question).toBe("this touches billing");
  });

  test("all three directives in one reply keep delegate+consult, escalate wins", () => {
    const raw = [
      "work",
      "@delegate(to: @spotter, task: scout)",
      "@consult(to: @foreman, question: ok?)",
    ].join("\n");
    const out = parseReply(raw, "wrecker");
    expect(out.handoffs[0]?.to).toBe("spotter");
    expect(out.consult?.to).toBe("foreman");
  });
});

describe("slugifyTag", () => {
  test("human names become kebab tags", () => {
    expect(slugifyTag("Debug & Repair Generalist")).toBe("debug-repair-generalist");
    expect(slugifyTag("Android App Builder")).toBe("android-app-builder");
    expect(slugifyTag("firebase-security-rules-auditor")).toBe("firebase-security-rules-auditor");
  });
  test("handles pathological input", () => {
    expect(slugifyTag("!!!")).toBe("temp");
    expect(slugifyTag("a very long name ".repeat(10)).length).toBeLessThanOrEqual(48);
  });
});

describe("mapTools", () => {
  test("maps copilot verbs onto yarddog tools", () => {
    const { tools, dropped } = mapTools(["read", "search", "edit", "execute"]);
    expect(tools.sort()).toEqual(["grep", "read_file", "shell", "write_file"]);
    expect(dropped).toEqual([]);
  });

  test("maps claude-code canonical names", () => {
    const { tools, dropped } = mapTools(["Read", "Write", "Edit", "Bash", "Grep", "Glob"]);
    expect(tools.sort()).toEqual(["grep", "list_files", "read_file", "shell", "write_file"]);
    expect(dropped).toEqual([]);
  });

  test("platform sub-delegation tools point at @delegate protocol", () => {
    const { tools, dropped } = mapTools(["agent", "Task"]);
    expect(tools).toEqual([]);
    expect(dropped.join(" ")).toContain("@delegate");
  });
  test("drops unknown vendor tools with receipt", () => {
    const { tools, dropped } = mapTools(["read", "web", "browser", "todos", "vscode/askQuestions"]);
    expect(tools).toEqual(["read_file"]);
    expect(dropped).toEqual(["web", "browser", "todos", "vscode/askQuestions"]);
  });
  test("empty/undefined tools map cleanly", () => {
    expect(mapTools(undefined)).toEqual({ tools: [], dropped: [] });
    expect(mapTools([])).toEqual({ tools: [], dropped: [] });
  });
});

function fakeSpec(overrides: Partial<AgentSpec>): AgentSpec {
  return {
    name: "Test Temp",
    description: "a hired gun for tests",
    body: "You are a test temp. Do test things.",
    companionFiles: [],
    provenance: { kind: "local", vendor: "copilot", path: "/tmp/test.agent.md" },
    ...overrides,
  } as AgentSpec;
}

describe("specToTempDef", () => {
  test("converts a copilot-style spec into an AgentDef", () => {
    const { def, notes } = specToTempDef(fakeSpec({ tools: ["read", "search", "web"] }));
    expect(def.tag).toBe("test-temp");
    expect(def.systemPrompt).toContain("test temp");
    // remember is granted to every temp automatically
    expect(def.tools.sort()).toEqual(["grep", "read_file", "remember"]);
    expect(def.temp?.vendor).toBe("copilot");
    expect(def.memory).toBe("");
    expect(notes.join("\n")).toContain("no yarddog equivalent for tools: web");
  });

  test("vendor model declarations are ignored because ModelHitch owns routing", () => {
    const fallback = specToTempDef(fakeSpec({ model: "sonnet" }));
    expect(fallback.notes.join("\n")).toContain('model "sonnet" ignored');

    const explicit = specToTempDef(fakeSpec({ model: "anthropic/claude-sonnet-4" }));
    expect(explicit.notes.join("\n")).toContain('model "anthropic/claude-sonnet-4" ignored');
    expect(explicit.def).not.toHaveProperty("provider");
    expect(explicit.def).not.toHaveProperty("model");
  });

  test("'inherit' model is silent — no lane note", () => {
    const r = specToTempDef(fakeSpec({ model: "inherit" }));
    expect(r.notes.filter((n) => n.includes("model"))).toEqual([]);
  });
});
