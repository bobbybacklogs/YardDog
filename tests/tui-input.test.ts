import { describe, expect, test } from "bun:test";
import { BoxRenderable, InputRenderable, TextRenderable } from "@opentui/core";
import { KeyCodes, createTestRenderer } from "@opentui/core/testing";

/**
 * Regression guards for the composer's input wiring:
 *   1. Enter emits "enter" (NOT "submit") with a readable, clearable value.
 *   2. Explicit width — the first keystroke must render immediately
 *      (width "auto" renders nothing until the second keystroke).
 *   3. @-mention autocomplete: suggestions appear, Tab accepts the top one.
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

  test("first keystroke renders immediately with explicit width", async () => {
    const setup = await createTestRenderer({ width: 40, height: 6 });
    try {
      const composer = new BoxRenderable(setup.renderer, {
        flexDirection: "row",
        height: 3,
        borderStyle: "rounded",
        paddingLeft: 1,
      });
      setup.renderer.root.add(composer);
      const input = new InputRenderable(setup.renderer, {
        placeholder: "type here",
        width: "100%",
      });
      composer.add(input);
      input.focus();

      await setup.mockInput.typeText("/");
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("/");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("@ mention autocomplete shows and Tab accepts", async () => {
    const setup = await createTestRenderer({ width: 50, height: 10 });
    try {
      const col = new BoxRenderable(setup.renderer, { flexDirection: "column", flexGrow: 1 });
      setup.renderer.root.add(col);
      const suggest = new BoxRenderable(setup.renderer, { flexDirection: "column", height: 0 }) as unknown as {
        add(child: unknown): void;
        remove(child: unknown): void;
        height: number;
      };
      col.add(suggest);
      const composer = new BoxRenderable(setup.renderer, { flexDirection: "row", height: 3, borderStyle: "single" });
      col.add(composer);
      const input = new InputRenderable(setup.renderer, { width: "100%" });
      composer.add(input);
      input.focus();

      const AGENTS = ["foreman", "wrecker", "spotter", "mule"];
      let active: string[] = [];
      input.on("input", () => {
        const m = /(?:^|\s)@(\S*)$/.exec(String(input.value ?? ""));
        active = m ? AGENTS.filter((a) => a.startsWith(m[1]!)) : [];
        for (let i = 0; i < active.length; i++) {
          suggest.add(new TextRenderable(setup.renderer, { content: `@${active[i]}`, fg: "#FFD75E" }));
        }
        suggest.height = active.length;
      });
      setup.renderer.keyInput.on("keypress", (key: { name?: string }) => {
        if (key.name === "tab" && active.length > 0) {
          input.value = String(input.value ?? "").replace(/@(\S*)$/, `@${active[0]!} `);
        }
      });

      await setup.mockInput.typeText("ask @wr");
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("@wrecker");

      await setup.mockInput.pressKey(KeyCodes.TAB);
      await setup.renderOnce();
      expect(input.value).toBe("ask @wrecker ");
    } finally {
      setup.renderer.destroy();
    }
  });
});
