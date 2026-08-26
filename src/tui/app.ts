import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { ThreadMessage, YardDogEvent } from "../core/types";

/**
 * The yard floor — YardDog's OpenTUI.
 *
 *   ┌ crew ─────┬ thread feed ─────────────────────┐
 *   │ @foreman  │ messages + handoff chips          │
 *   │ @wrecker  │                                   │
 *   ├───────────┴───────────────────────────────────┤
 *   │ input                                          │
 *   └───────────────────────────────────────────────┘
 *
 * Built on the Renderable API (BoxRenderable/TextRenderable/…), not the
 * proxied construct factories: renderables are real instances whose
 * properties can be mutated after mount, which the constructs' VNode
 * proxies don't support reliably. Two rules of the road learned the hard
 * way (see tests/tui.test.ts):
 *
 *   1. Never read `.content` back for mutation — it returns a StyledText
 *      object. Keep the source string in your own state and assign whole
 *      new strings.
 *   2. Containers have no enumerable children API here — track what you
 *      added and `remove()` it yourself.
 */

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
  let thread = dog.activeThread();

  // ---- Helpers: the two rules of the road, encapsulated --------------------

  function makeText(content: string, fg = "#c8c8c8"): TextRenderable {
    return new TextRenderable(renderer, { content, fg });
  }

  /** A container whose children we track so we can actually clear it. */
  class TrackedBox {
    readonly node: { add(child: unknown): void; remove(child: unknown): void };
    private children: unknown[] = [];
    constructor(node: { add(child: unknown): void; remove(child: unknown): void }) {
      this.node = node;
    }
    add(child: BoxRenderable | TextRenderable): void {
      this.node.add(child);
      this.children.push(child);
    }
    clear(): void {
      for (const child of this.children) {
        try {
          this.node.remove(child);
        } catch {
          // already detached — fine
        }
      }
      this.children = [];
    }
  }

  // ---- Static layout -------------------------------------------------------

  const rootCol = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1 });
  renderer.root.add(rootCol);

  const headerRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    gap: 2,
    paddingLeft: 1,
    height: 1,
  });
  rootCol.add(headerRow);
  const headerTitle = new TextRenderable(renderer, { content: "YARDDOG", fg: "#FFD75E" });
  const headerThread = new TextRenderable(renderer, { content: "", fg: "#888888" });
  const headerSkills = new TextRenderable(renderer, { content: "", fg: "#B78AFF" });
  headerRow.add(headerTitle);
  headerRow.add(headerThread);
  headerRow.add(headerSkills);

  const body = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1 });
  rootCol.add(body);

  const fleetBox = new TrackedBox(
    new BoxRenderable(renderer, {
      flexDirection: "column",
      width: 30,
      borderStyle: "single",
      borderColor: "#444444",
      paddingLeft: 1,
      title: " crew ",
    }),
  );
  body.add(fleetBox.node);

  const feed = new TrackedBox(
    new ScrollBoxRenderable(renderer, {
      flexDirection: "column",
      flexGrow: 1,
      borderStyle: "single",
      borderColor: "#444444",
      paddingLeft: 1,
      paddingRight: 1,
      stickyScroll: true,
    }),
  );
  body.add(feed.node);

  const composerBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 3,
    borderStyle: "rounded",
    borderColor: "#FFD75E",
    paddingLeft: 1,
    title: " give the dog a job ",
  });

  // Autocomplete overlay — sits between feed and composer, height 0 when idle.
  const suggestBox = new BoxRenderable(renderer, { flexDirection: "column", height: 0 }) as unknown as {
    add(child: unknown): void;
    remove(child: unknown): void;
    height: number;
  };
  let suggestChildren: TextRenderable[] = [];
  const rootColForSuggest = rootCol;
  rootColForSuggest.add(suggestBox);
  rootColForSuggest.add(composerBox);

  const input = new InputRenderable(renderer, {
    placeholder: "/help for commands · job, or @mention a teammate…",
    placeholderColor: "#555555",
    textColor: "#e8e8e8",
    cursorColor: "#FFD75E",
    // "auto" width renders the first keystroke invisible and re-lays-out as
    // text grows — the input must claim the full row up front.
    width: "100%",
  });
  composerBox.add(input);

  const statusText = new TextRenderable(renderer, { content: "idle", fg: "#888888" });
  rootCol.add(statusText);

  // ---- Renderers ------------------------------------------------------------

  function renderHeader(): void {
    headerThread.content = `${thread.id} — ${thread.title}`;
    headerSkills.content = skillNames.length > 0 ? `skills: ${skillNames.join(", ")}` : "";
  }

  function renderFleet(): void {
    fleetBox.clear();
    for (const agent of dog.agents) {
      const presence = dog.getPresence(agent.tag);
      const badge = agent.temp ? "~" : " ";
      fleetBox.add(
        makeText(
          `${PRESENCE_DOT[presence] ?? "·"}${badge} @${agent.tag} — ${presence}`,
          PRESENCE_COLOR[presence] ?? "#cccccc",
        ),
      );
    }
    fleetBox.add(makeText(" ", "#444444"));
    fleetBox.add(makeText(" ~ = hired temp", "#666666"));

    const threads = dog.listThreads().slice(0, Math.max(3, 10 - dog.agents.length));
    if (threads.length > 0) {
      fleetBox.add(makeText(" ── threads ──", "#555555"));
      for (const t of threads) {
        const current = t.id === thread.id;
        fleetBox.add(
          makeText(
            `${current ? "▸" : " "} ${t.id} ${t.title.slice(0, 14)}`,
            current ? "#FFD75E" : "#777777",
          ),
        );
      }
      fleetBox.add(makeText(" /open <id>", "#555555"));
    }
  }

  function messageLines(msg: ThreadMessage): Array<{ text: string; fg: string }> {
    const isUser = msg.from === "user";
    const authorColor = isUser ? "#5EFF8B" : "#5EB7FF";
    const lines = [
      { text: "", fg: "#444444" },
      { text: `@${msg.from}  ${new Date(msg.ts).toLocaleTimeString()}`, fg: authorColor },
      { text: msg.text, fg: isUser ? "#e8e8e8" : "#c8c8c8" },
    ];
    for (const h of msg.handoffs ?? []) {
      lines.push({ text: `  ⇄ handed off to @${h.to} — ${h.task}`, fg: "#5EB7FF" });
    }
    if (msg.consult) {
      lines.push({ text: `  ? consulted @${msg.consult.to}: ${msg.consult.question}`, fg: "#B78AFF" });
    }
    if (msg.escalation) {
      lines.push({ text: `  ! ESCALATED: ${msg.escalation.question}`, fg: "#FF5E5E" });
    }
    if (msg.meta?.failedOver) {
      lines.push({ text: "  ⚡ served via failover lane", fg: "#FFD75E" });
    }
    if (msg.meta?.usage?.totalTokens) {
      lines.push({
        text: `  ${msg.meta.usage.totalTokens} tok${msg.meta.turns ? ` · ${msg.meta.turns} turns` : ""}`,
        fg: "#555555",
      });
    }
    return lines;
  }

  function renderFeed(): void {
    feed.clear();
    if (thread.messages.length === 0) {
      feed.add(
        makeText(
          "Empty yard. Give the crew a job below.\n@mention a teammate to route directly, or let the foreman dispatch.",
          "#666666",
        ),
      );
      return;
    }
    for (const msg of thread.messages) {
      for (const line of messageLines(msg)) feed.add(makeText(line.text, line.fg));
    }
  }

  function feedLine(text: string, fg = "#c8c8c8"): void {
    feed.add(makeText(text, fg));
  }

  function updateStatus(s: string): void {
    statusText.content = s;
  }

  // ---- Input ----------------------------------------------------------------

  input.on("enter", () => {
    const value = String(input.value ?? "").trim();
    if (!value) return;
    input.value = "";
    hideSuggestions();
    void submit(value);
  });

  // ---- Autocomplete: @mentions, @directives, /commands ---------------------

  const COMMANDS = ["new", "open", "threads", "hire", "fire", "skill", "skills", "help"];
  const DIRECTIVES = ["delegate", "consult", "escalate"];
  let activeSuggestions: string[] = [];

  function currentToken(value: string): { kind: "mention" | "command"; prefix: string } | null {
    const cmd = /^\/(\S*)$/.exec(value);
    if (cmd) return { kind: "command", prefix: cmd[1]! };
    const mention = /(?:^|\s)@(\S*)$/.exec(value);
    if (mention) return { kind: "mention", prefix: mention[1]! };
    return null;
  }

  function computeSuggestions(value: string): string[] {
    const tok = currentToken(value);
    if (!tok) return [];
    const p = tok.prefix.toLowerCase();
    if (tok.kind === "command") {
      return COMMANDS.filter((c) => c.startsWith(p));
    }
    const tags = dog.agents.map((a) => a.tag);
    return [...tags, ...DIRECTIVES].filter((t) => t.toLowerCase().startsWith(p));
  }

  function showSuggestions(items: string[]): void {
    for (const child of suggestChildren) {
      try {
        suggestBox.remove(child);
      } catch {}
    }
    suggestChildren = [];
    activeSuggestions = items;
    if (items.length === 0) {
      suggestBox.height = 0;
      return;
    }
    const shown = items.slice(0, 4);
    for (let i = 0; i < shown.length; i++) {
      const tok = currentToken(String(input.value ?? ""));
      const label =
        tok?.kind === "command"
          ? `/${shown[i]!}`
          : `@${shown[i]!}${DIRECTIVES.includes(shown[i]!) ? "  (directive)" : "  (crew)"}`;
      const t = new TextRenderable(renderer, {
        content: (i === 0 ? "▸ " : "  ") + label + (i === 0 ? "   [Tab]" : ""),
        fg: i === 0 ? "#FFD75E" : "#888888",
      });
      suggestBox.add(t);
      suggestChildren.push(t);
    }
    suggestBox.height = shown.length;
  }

  function hideSuggestions(): void {
    showSuggestions([]);
  }

  input.on("input", () => {
    showSuggestions(computeSuggestions(String(input.value ?? "")));
  });

  function acceptSuggestion(): void {
    if (activeSuggestions.length === 0) return;
    const pick = activeSuggestions[0]!;
    const value = String(input.value ?? "");
    if (/^\/\S*$/.test(value)) {
      input.value = `/${pick} `;
    } else {
      input.value = value.replace(/@(\S*)$/, `@${pick} `);
    }
    hideSuggestions();
  }

  renderer.keyInput.on("keypress", (key: { name?: string }) => {
    if (key.name === "tab") acceptSuggestion();
  });

  async function submit(text: string): Promise<void> {
    if (text.startsWith("/")) {
      await handleCommand(text);
      return;
    }
    try {
      await dog.send(thread.id, text, { skills: skillNames });
    } catch (err) {
      feedLine(`✗ ${(err as Error).message}`, "#FF5E5E");
    }
  }

  // ---- Slash commands ---------------------------------------------------------

  async function handleCommand(raw: string): Promise<void> {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const argsLine = raw.slice(1 + cmd!.length).trim();

    switch (cmd) {
      case "new": {
        thread = dog.createThread(argsLine || "New job");
        renderHeader();
        renderFeed();
        updateStatus(`switched to ${thread.id}`);
        break;
      }
      case "open": {
        const target = dog.getThread(argsLine.trim());
        if (!target) {
          feedLine(`✗ no thread "${argsLine.trim()}"`, "#FF5E5E");
          break;
        }
        thread = target;
        renderHeader();
        renderFeed();
        updateStatus(`switched to ${thread.id}`);
        break;
      }
      case "threads": {
        for (const t of dog.listThreads()) {
          feedLine(
            `${t.id}  ${t.title}  (${t.messages.length} msgs)${t.id === thread.id ? " ←" : ""}`,
            t.id === thread.id ? "#FFD75E" : "#888888",
          );
        }
        break;
      }
      case "hire": {
        for (const name of argsLine.split(",").map((s) => s.trim()).filter(Boolean)) {
          try {
            const { def, notes } = await dog.hireTemp(name);
            feedLine(`+ hired @${def.tag} (${def.temp?.vendor})`, "#5EFF8B");
            for (const note of notes) {
              feedLine(`    note: ${note}`, "#666666");
            }
          } catch (err) {
            feedLine(`✗ hire failed: ${(err as Error).message}`, "#FF5E5E");
          }
        }
        renderFleet();
        break;
      }
      case "fire": {
        for (const tag of argsLine.split(",").map((s) => s.trim()).filter(Boolean)) {
          const fired = dog.fireTemp(tag);
          feedLine(fired ? `- fired @${tag.toLowerCase()}` : `@${tag.toLowerCase()} is not on payroll`, fired ? "#FFD75E" : "#FF5E5E");
        }
        renderFleet();
        break;
      }
      case "skill": {
        skillNames.length = 0;
        for (const name of argsLine.split(",").map((s) => s.trim()).filter(Boolean)) {
          skillNames.push(name);
        }
        renderHeader();
        feedLine(
          skillNames.length > 0 ? `skills attached: ${skillNames.join(", ")}` : "skills cleared",
          "#B78AFF",
        );
        break;
      }
      case "skills": {
        const { discoverSkillLibrary } = await import("../core/library");
        for (const s of await discoverSkillLibrary()) {
          feedLine(`  ${s.name.padEnd(38)} ${(s.description || "").slice(0, 70)}`, "#888888");
        }
        break;
      }
      case "help": {
        for (const line of [
          "/new [title] — new thread   /open <id> — switch   /threads — list",
          "/hire <name[,name]> — hire temps   /fire <tag> — clock out temps",
          "/skill <name,...> — attach skills   /skills — list library",
          "type @ or / for autocomplete · Tab accepts · @delegate/@consult/@escalate",
        ]) {
          feedLine(line, "#888888");
        }
        break;
      }
      default:
        feedLine(`✗ unknown command "/${cmd}" — try /help`, "#FF5E5E");
    }
  }

  // ---- Live event rendering ---------------------------------------------------

  let liveLine: TextRenderable | null = null;
  let liveText = "";
  let liveTag = "";

  dog.on("event", (event: YardDogEvent) => {
    switch (event.type) {
      case "turn:start": {
        liveLine = null;
        liveText = "";
        liveTag = event.agentTag;
        updateStatus(`@${event.agentTag} working…`);
        break;
      }
      case "delta": {
        if (!liveLine || liveTag !== event.agentTag) {
          liveTag = event.agentTag;
          liveText = `\n@${event.agentTag}: `;
          liveLine = makeText(liveText, "#5EB7FF");
          feed.add(liveLine);
        }
        liveText += event.text; // rule 1: track the string ourselves
        liveLine.content = liveText; // and assign whole strings
        break;
      }
      case "tool": {
        feedLine(`  ⚙ @${event.agentTag} → ${event.name}`, "#FFD75E");
        break;
      }
      case "handoff": {
        renderFleet();
        feedLine(`\n  ⇄ @${event.handoff.from} handed off to @${event.handoff.to}: ${event.handoff.task}`, "#5EB7FF");
        break;
      }
      case "consult": {
        feedLine(`\n  ? @${event.consult.from} consulted @${event.consult.to}: ${event.consult.question}`, "#B78AFF");
        break;
      }
      case "escalate": {
        renderFleet();
        feedLine(`\n  ! @${event.escalation.from} needs you: ${event.escalation.question}`, "#FF5E5E");
        break;
      }
      case "error": {
        renderFleet();
        feedLine(`\n  ✗ ${event.agentTag ? `@${event.agentTag}: ` : ""}${event.error}`, "#FF5E5E");
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

  // ---- Go -----------------------------------------------------------------------

  renderHeader();
  renderFleet();
  renderFeed();
  updateStatus(
    skillNames.length > 0 ? `idle · skills attached: ${skillNames.join(", ")}` : "idle",
  );
  input.focus();

  await new Promise<never>(() => {
    // The renderer owns the process until Ctrl+C (exitOnCtrlC).
  });
}

/** Exposed for tests: the renderer type this app builds against. */
export type { CliRenderer };
