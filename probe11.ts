import { BoxRenderable, InputRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { appendFileSync } from "node:fs";
const L = (m: string) => appendFileSync("C:/Users/labs/AppData/Local/Temp/probe11.log", m + "\n");

const LONG = "help me audit the repo and fix all the broken imports please crew"; // 65 chars

async function trial(label: string, width: number | string, flexGrow?: number) {
  const setup = await createTestRenderer({ width: 60, height: 6 });
  try {
    const composer = new BoxRenderable(setup.renderer, {
      flexDirection: "row",
      height: 3,
      borderStyle: "rounded",
      paddingLeft: 1,
    });
    setup.renderer.root.add(composer);
    const input = new InputRenderable(setup.renderer, { placeholder: "type here", width });
    if (flexGrow) (input as unknown as { flexGrow: number }).flexGrow = flexGrow;
    composer.add(input);
    input.focus();
    await setup.renderOnce();
    await setup.mockInput.typeText(LONG);
    await setup.renderOnce();
    const f = setup.captureCharFrame();
    const line = f.split("\n").find((l) => l.includes("crew")) ?? "(none)";
    // count visible chars of the typed text
    const visible = LONG.split("").filter((c) => line.includes(c)).length;
    L(`${label}: line=${JSON.stringify(line.trim())} visibleChars~${visible}`);
  } finally {
    setup.renderer.destroy();
  }
}

await trial("width=100%", "100%");
await trial("width=54 fixed", 54);
await trial("width=999", 999);
await trial("flexGrow=1 auto", "auto", 1);
