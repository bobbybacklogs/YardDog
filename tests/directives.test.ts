import { describe, expect, test } from "bun:test";
import { parseReply } from "../src/core/directives";

describe("parseReply", () => {
  test("parses and strips a trailing @delegate", () => {
    const raw = "Here's my plan. Done my part.\n@delegate(to: @wrecker, task: fix the imports)";
    const out = parseReply(raw, "foreman");
    expect(out.clean).toBe("Here's my plan. Done my part.");
    expect(out.handoffs).toEqual([{ from: "foreman", to: "wrecker", task: "fix the imports" }]);
    expect(out.consult).toBeUndefined();
    expect(out.escalation).toBeUndefined();
  });

  test("tolerates optional @ on the target tag", () => {
    const out = parseReply("x\n@delegate(to:@mule , task: write README)", "spotter");
    expect(out.handoffs[0]?.to).toBe("mule");
  });

  test("collects MULTIPLE delegates for parallel dispatch", () => {
    const raw = [
      "Dispatching.",
      "@delegate(to: @wrecker, task: fix imports)",
      "@delegate(to: @mule, task: update docs)",
      "@delegate(to: @spotter, task: map auth flow)",
    ].join("\n");
    const out = parseReply(raw, "foreman");
    expect(out.handoffs).toHaveLength(3);
    expect(out.clean).not.toContain("@delegate");
  });

  test("caps delegates at MAX_DELEGATES_PER_REPLY", () => {
    const raw = [
      "too eager",
      "@delegate(to: @wrecker, task: a)",
      "@delegate(to: @mule, task: b)",
      "@delegate(to: @spotter, task: c)",
      "@delegate(to: @foreman, task: d)",
    ].join("\n");
    const out = parseReply(raw, "wrecker");
    expect(out.handoffs.length).toBe(3);
    expect(out.clean).not.toContain("@delegate"); // extras still stripped
  });

  test("escalation wins over delegation", () => {
    const raw = [
      "Both look plausible.",
      "@delegate(to: @wrecker, task: pick one)",
      "@escalate(which database should we pick?)",
    ].join("\n");
    const out = parseReply(raw, "foreman");
    expect(out.handoffs).toEqual([]);
    expect(out.escalation?.from).toBe("foreman");
    expect(out.escalation?.question).toBe("which database should we pick?");
    expect(out.clean).not.toContain("@delegate");
    expect(out.clean).not.toContain("@escalate");
  });

  test("plain replies pass through untouched", () => {
    const out = parseReply("Just an answer, nothing to route.", "spotter");
    expect(out.clean).toBe("Just an answer, nothing to route.");
    expect(out.handoffs).toEqual([]);
    expect(out.escalation).toBeUndefined();
  });

  test("malformed directives are left visible rather than half-parsed", () => {
    const raw = "partial @delegate(to: nobody-valid";
    const out = parseReply(raw, "foreman");
    expect(out.handoffs).toEqual([]);
  });

  test("multi-line task text is captured", () => {
    const raw = "done.\n@delegate(to: @mule, task: document the API\ninclude examples)";
    const out = parseReply(raw, "wrecker");
    expect(out.handoffs[0]?.task).toContain("document the API");
  });
});
