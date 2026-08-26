import { BoxRenderable, InputRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { appendFileSync } from "node:fs";
const L = (m: string) => appendFileSync("C:/Users/labs/AppData/Local/Temp/probe10.log", m + "\n");

// replicate the composer: bordered box h3, input inside
const setup = await createTestRenderer({ width: 60, height: 8 });
try {
  const col = new BoxRenderable(setup.renderer, { flexDirection: "column", flexGrow: 1 });
  setup.renderer.root.add(col);
  const composer = new BoxRenderable(setup.renderer, {
    flexDirection: "row",
    height: 3,
    borderStyle: "rounded",
    paddingLeft: 1,
  });
  col.add(composer);
  const input = new InputRenderable(setup.renderer, {
    placeholder: "type here",
    width: "100%",
    textColor: "#e8e8e8",
  });
  composer.add(input);
  input.focus();
  await setup.renderOnce();

  // type one char, check frame
  await setup.mockInput.typeText("/");
  await setup.renderOnce();
  let f = setup.captureCharFrame();
  L("after '/': shows slash=" + f.includes("/") + "  frame-line: " + JSON.stringify(f.split("\n").filter((l) => l.includes("/"))[0] ?? "(none)"));

  // type a long sentence
  await setup.mockInput.typeText("help me audit the repo and fix all the broken imports please crew");
  await setup.renderOnce();
  f = setup.captureCharFrame();
  const lines = f.split("\n");
  L("long text lines containing 'audit': " + JSON.stringify(lines.filter((l) => l.includes("audit"))));
  L("long text lines containing 'broken': " + JSON.stringify(lines.filter((l) => l.includes("broken"))));
  L("full frame:\n" + f);
} finally {
  setup.renderer.destroy();
}
