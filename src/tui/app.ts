import { Box, Input, Text, ScrollBox, createCliRenderer } from "@opentui/core";
import type { ThreadMessage, YardDogEvent } from "../core/types";

/**
 * The yard floor — YardDog's OpenTUI.
 *
 *   ┌ crew ─────┬ thread feed ─────────────────────┐
 *   │ @foreman  │ messages + handoff chips          │
 *   │ @wrecker  │                                   │
 *   ├───────────┴───────────────────────────────────┤
 *   │ input                                          │
 *   └────────────────────────────────────────────────┘
 *
 * Note: OpenTUI's proxied VNode typings lag the runtime API (child add/remove,
 * content mutation), so containers are narrowed through small structural
 * interfaces below instead of `any` sprinkled everywhere.
 */

interface MutableText {
  content: string;
  fg: string;
}

interface Container {
  add(child: unknown): void;
  remove(child: unknown): void;
}

type TextNode = ReturnType<typeof Text>;

const PRESENCE_DOT: Record<string, string> = {
  idle: "·",
  working: "▲",
  handoff: "⇄",
  escalated: "!",
  error: "✗",
};

const PRESENCE_COLOR: Record<string, string> = {
  idle: "#666666",
  working: "#FFD75E",
  handoff: "#5EB7FF",
  escalated: "#FF5E5E",
  error: "#FF5E5E",
};

export async function runTui(opts: { hires?: string[]; skills?: string[] } = {}): Promise<void> {
  // Imported lazily so headless commands don't pay the harness cost.
  const { YardDog } = await import("../core/harness");
  const dog = await YardDog.create();
  for (const name of opts.hires ?? []) {
    try {
      const { def, notes } = await dog.hireTemp(name);
      for (const note of notes) console.error(`hire note (@${def.tag}): ${note}`);
    } catch (err) {
      console.error(`hire failed: ${(err as Error).message}`);
    }
  }
  // Skills are job-scoped; the TUI keeps a persistent attach list for the session.
  const skillNames = [...(opts.skills ?? [])];

  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const thread = dog.activeThread();

  const root = Box({ flexDirection: "column", flexGrow: 1 });
  renderer.root.add(root);

  // ---- Header -----------------------------------------------------------

  root.add(
    Box(
      { flexDirection: "row", gap: 2, paddingLeft: 1, height: 1 },
      Text({ content: "YARDDOG", fg: "#FFD75E" }),
      Text({ content: thread.title, fg: "#888888" }),
    ),
  );

  // ---- Body -------------------------------------------------------------

  const body = Box({ flexDirection: "row", flexGrow: 1 });
  root.add(body);

  // Fleet sidebar ---------------------------------------------------------

  const fleetBox = Box({
    flexDirection: "column",
    width: 28,
    borderStyle: "single",
    borderColor: "#444444",
    paddingLeft: 1,
    title: " crew ",
  }) as unknown as Container;
  body.add(fleetBox);

  function renderFleet(): void {
    for (const agent of dog.agents) {
      const presence = dog.getPresence(agent.tag);
      const badge = agent.temp ? "~" : " ";
      fleetBox.add(
        Text({
          content: `${PRESENCE_DOT[presence]}${badge}@${agent.tag.padEnd(10)} ${presence}`,
          fg: PRESENCE_COLOR[presence] ?? "#cccccc",
        }),
      );
    }
    fleetBox.add(Text({ content: " ", fg: "#444444" }));
    fleetBox.add(Text({ content: " ~ = hired temp", fg: "#666666" }));
  }

  // Feed ------------------------------------------------------------------

  const feed = ScrollBox({
    flexDirection: "column",
    flexGrow: 1,
    borderStyle: "single",
    borderColor: "#444444",
    paddingLeft: 1,
    paddingRight: 1,
  }) as unknown as Container & { scrollToBottom?: () => void };
  body.add(feed);

  function renderMessage(msg: ThreadMessage): TextNode[] {
    const isUser = msg.from === "user";
    const authorColor = isUser ? "#5EFF8B" : "#5EB7FF";
    const nodes: TextNode[] = [
      Text({ content: "" }),
      Box(
        { flexDirection: "row", gap: 1 } as never,
        Text({ content: `@${msg.from}`, fg: authorColor }),
        Text({ content: new Date(msg.ts).toLocaleTimeString(), fg: "#555555" }),
      ) as unknown as TextNode,
      Text({ content: msg.text, fg: isUser ? "#e8e8e8" : "#c8c8c8" }),
    ];
    for (const h of msg.handoffs ?? []) {
      nodes.push(
        Text({
          content: `  ⇄ handed off to @${h.to} — ${h.task}`,
          fg: "#5EB7FF",
        }),
      );
    }
    if (msg.consult) {
      nodes.push(
        Text({ content: `  ? consulted @${msg.consult.to}: ${msg.consult.question}`, fg: "#B78AFF" }),
      );
    }
    if (msg.escalation) {
      nodes.push(Text({ content: `  ! ESCALATED: ${msg.escalation.question}`, fg: "#FF5E5E" }));
    }
    if (msg.meta?.failedOver) {
      nodes.push(Text({ content: "  ⚡ served via failover lane", fg: "#FFD75E" }));
    }
    if (msg.meta?.usage?.totalTokens) {
      nodes.push(
        Text({
          content: `  ${msg.meta.usage.totalTokens} tok${msg.meta.turns ? ` · ${msg.meta.turns} turns` : ""}`,
          fg: "#555555",
        }),
      );
    }
    return nodes;
  }

  function renderFeed(): void {
    clearContainer(feed);
    if (thread.messages.length === 0) {
      feed.add(
        Text({
          content:
            "Empty yard. Give the crew a job below.\n@mention a teammate to route directly, or let the foreman dispatch.",
          fg: "#666666",
        }),
      );
      return;
    }
    for (const msg of thread.messages) {
      for (const node of renderMessage(msg)) feed.add(node);
    }
  }

  function clearContainer(container: Container): void {
    const withChildren = container as unknown as { getChildren?: () => unknown[] };
    const children = withChildren.getChildren?.() ?? [];
    for (const child of children) container.remove(child);
  }

  // Composer --------------------------------------------------------------

  const composerRow = Box({
    flexDirection: "row",
    height: 3,
    borderStyle: "rounded",
    borderColor: "#FFD75E",
    paddingLeft: 1,
    title: " give the dog a job ",
  });
  root.add(composerRow);

  const input = Input({
    placeholder: "Describe the job, or @mention a teammate… (Enter to send)",
    placeholderColor: "#555555",
    backgroundColor: "#101010",
    textColor: "#e8e8e8",
    cursorColor: "#FFD75E",
  });
  composerRow.add(input);

  input.on("enter", () => {
    const value = String((input as unknown as { value: string }).value ?? "").trim();
    if (!value || dog.working) return;
    (input as unknown as { value: string }).value = "";
    void submit(value);
  });

  async function submit(text: string): Promise<void> {
    try {
      await dog.send(thread.id, text, { skills: skillNames });
    } catch (err) {
      feed.add(Text({ content: `✗ ${(err as Error).message}`, fg: "#FF5E5E" }));
    }
  }

  // Status bar ------------------------------------------------------------

  let statusLine: MutableText | null = null;
  const statusBar = Box({ flexDirection: "row", height: 1, paddingLeft: 1 });
  root.add(statusBar);

  function updateStatus(s: string): void {
    if (!statusLine) {
      statusLine = Text({ content: s, fg: "#888888" }) as unknown as MutableText;
      statusBar.add(statusLine as unknown as TextNode);
    } else {
      statusLine.content = s;
    }
  }

  // ---- Live event rendering ----------------------------------------------

  let liveLine: MutableText | null = null;
  let liveTag = "";

  dog.on("event", (event: YardDogEvent) => {
    switch (event.type) {
      case "turn:start": {
        liveLine = null;
        liveTag = event.agentTag;
        updateStatus(`@${event.agentTag} working…`);
        break;
      }
      case "delta": {
        if (!liveLine || liveTag !== event.agentTag) {
          liveTag = event.agentTag;
          liveLine = Text({
            content: `\n@${event.agentTag}: `,
            fg: "#5EB7FF",
          }) as unknown as MutableText;
          feed.add(liveLine as unknown as TextNode);
        }
        liveLine.content += event.text;
        break;
      }
      case "tool": {
        feed.add(Text({ content: `  ⚙ @${event.agentTag} → ${event.name}`, fg: "#FFD75E" }));
        break;
      }
      case "handoff": {
        renderFleet();
        feed.add(
          Text({
            content: `\n  ⇄ @${event.handoff.from} handed off to @${event.handoff.to}: ${event.handoff.task}`,
            fg: "#5EB7FF",
          }),
        );
        break;
      }
      case "consult": {
        feed.add(
          Text({
            content: `\n  ? @${event.consult.from} consulted @${event.consult.to}: ${event.consult.question}`,
            fg: "#B78AFF",
          }),
        );
        break;
      }
      case "escalate": {
        renderFleet();
        feed.add(
          Text({
            content: `\n  ! @${event.escalation.from} needs you: ${event.escalation.question}`,
            fg: "#FF5E5E",
          }),
        );
        break;
      }
      case "error": {
        renderFleet();
        feed.add(
          Text({ content: `\n  ✗ ${event.agentTag ? `@${event.agentTag}: ` : ""}${event.error}`, fg: "#FF5E5E" }),
        );
        break;
      }
      case "turn:end": {
        renderFleet();
        updateStatus(dog.working ? "crew on it…" : "idle");
        renderFeed();
        break;
      }
      default:
        break;
    }
  });

  // ---- Go ----------------------------------------------------------------

  renderFleet();
  renderFeed();
  updateStatus(
    skillNames.length > 0
      ? `idle · skills attached: ${skillNames.join(", ")}`
      : "idle",
  );
  input.focus();

  await new Promise<never>(() => {
    // The renderer owns the process until Ctrl+C (exitOnCtrlC).
  });
}
