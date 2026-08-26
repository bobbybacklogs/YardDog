import { BoxRenderable, InputRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { appendFileSync } from "node:fs";
const L = (m: string) => appendFileSync("C:/Users/labs/AppData/Local/Temp/probe12.log", m + "\n");

const LONG = "help me audit the repo and fix all the broken imports please crew";

const setup = await createTestRenderer({ width: 60, height: 6 });
try {
  const composer = new BoxRenderable(setup.renderer, {
    flexDirection: "row",
    height: 3,
    borderStyle: "rounded",
    paddingLeft: 1,
    title: " job ",
  });
  setup.renderer.root.add(composer);
  // exactly what the app does: no width prop at all
  const input = new InputRenderable(setup.renderer, {
    placeholder: "/help for commands · job, or @mention a teammate…",
    placeholderColor: "#555555",
    textColor: "#e8e8e8",
    cursorColor: "#FFD75E",
  });
  composer.add(input);
  input.focus();
  await setup.renderOnce();

  // first keystroke only
  await setup.mockInput.typeText("/");
  await setup.renderOnce();
  let f = setup.captureCharFrame();
  L("1st keystroke '/': " + JSON.stringify(f.split("\n").filter((l) => l.trim()).slice(0, 3)));

  await setup.mockInput.typeText(LONG);
  await setup.renderOnce();
  f = setup.captureCharFrame();
  L("after long: " + JSON.stringify(f.split("\n").filter((l) => l.trim()).slice(0, 4)));
} finally {
  setup.renderer.destroy();
}
