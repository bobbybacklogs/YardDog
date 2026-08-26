import { describe, expect, test } from "bun:test";
import { BoxRenderable, InputRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

/**
 * Verifies the input wiring contract the TUI depends on:
 * Enter must emit "enter" (NOT "submit"), `.value` must read the typed
 * string, and assigning `.value = ""` must clear it. Regression guard for
 * the "slash-help doesn't show" bug.
 */
describe("input wiring", () => {
  test("enter event fires with readable, clearable value", async () => {
    const setup = await createTestRenderer({ width: 40, height: 8 });
    try {
      const input = new InputRenderable(setup.renderer, {});
      setup.renderer.root.add(input);
      input.focus();

      let submitted = "";
      input.on("enter", () => {
        submitted = String(input.value ?? "");
        input.value = "";
      });

      await setup.mockInput.typeText("/help");
      await setup.mockInput.pressEnter();
      await setup.renderOnce();

      expect(submitted).toBe("/help");
      expect(input.value).toBe("");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("slash output lands in the feed and renders", async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 });
    try {
      const col = new BoxRenderable(setup.renderer, { flexDirection: "column", flexGrow: 1 });
      setup.renderer.root.add(col);
      const feed = new ScrollBoxRenderable(setup.renderer, { flexGrow: 1 });
      col.add(feed);

      // mirror of the TUI's /help handler
      feed.add(new TextRenderable(setup.renderer, { content: "/new [title] — new thread", fg: "#888888" }));
      feed.add(new TextRenderable(setup.renderer, { content: "/hire <name[,name]> — hire temps", fg: "#888888" }));
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      expect(frame).toContain("/new [title]");
      expect(frame).toContain("/hire");
    } finally {
      setup.renderer.destroy();
    }
  });
});
