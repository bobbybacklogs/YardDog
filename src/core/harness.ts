import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  ModelHitch,
  isModelHitchError,
  runToolLoop,
  type ModelMessage,
  type ToolDefinition,
} from "modelhitch";
import { parseReply } from "./directives";
import { buildSystemPrompt, historyToMessages } from "./prompts";
import { Store, type HarnessConfig } from "./store";
import { TOOLS, needsApproval, type ToolContext } from "./tools";
import { defaultCrew } from "./crew";
import type {
  AgentDef,
  Escalation,
  Handoff,
  Presence,
  Thread,
  ThreadMessage,
  TurnMeta,
  YardDogEvent,
} from "./types";

export interface YardDogOptions {
  /** All tool operations and persistence are confined here. Default: cwd. */
  workdir?: string;
}

/**
 * YardDog — the orchestration engine.
 *
 * Owns one ModelHitch instance (all LLM traffic goes through it), the crew,
 * and the threads. Emits typed events so any frontend (TUI today, anything
 * else tomorrow) can render runs live.
 */
export class YardDog extends EventEmitter {
  readonly mh: ModelHitch;
  readonly store: Store;
  config: HarnessConfig;

  private crew: AgentDef[] = [];
  private threads: Map<string, Thread> = new Map();
  private presence: Map<string, Presence> = new Map();
  private busy = false;
  /** Shared counter bumped by ModelHitch autoMode on every lane switch. */
  private readonly failoverCounter: { count: number };

  private constructor(
    mh: ModelHitch,
    store: Store,
    config: HarnessConfig,
    failoverCounter: { count: number },
  ) {
    super();
    this.mh = mh;
    this.store = store;
    this.config = config;
    this.failoverCounter = failoverCounter;
  }

  static async create(options: YardDogOptions = {}): Promise<YardDog> {
    const workdir = options.workdir ?? process.cwd();
    const store = new Store(workdir);
    await store.init();

    const config = await store.loadConfig();
    const failoverCounter = { count: 0 };
    const mh = new ModelHitch({
      autoMode: true,
      defaultProviderId: config.provider,
      defaultModel: config.model,
      // autoMode handles lane switching inside ModelHitch; we only count
      // switches so each turn's meta can report whether it was failed over.
      onFailover: () => {
        failoverCounter.count++;
      },
    });

    const dog = new YardDog(mh, store, config, failoverCounter);
    const existingCrew = await store.loadCrew();
    dog.crew = existingCrew ?? defaultCrew(config.provider, config.model);
    if (!existingCrew) await store.saveCrew(dog.crew);

    for (const thread of await store.loadThreads()) dog.threads.set(thread.id, thread);
    for (const agent of dog.crew) dog.presence.set(agent.tag, "idle");
    return dog;
  }

  // ---- Fleet -------------------------------------------------------------

  get agents(): AgentDef[] {
    return this.crew;
  }

  agent(tag: string): AgentDef | undefined {
    return this.crew.find((a) => a.tag === tag.toLowerCase());
  }

  getPresence(tag: string): Presence {
    return this.presence.get(tag) ?? "idle";
  }

  private setPresence(tag: string, presence: Presence): void {
    this.presence.set(tag, presence);
    this.emitEvent({ type: "presence", tag, presence });
  }

  get working(): boolean {
    return this.busy;
  }

  // ---- Threads -----------------------------------------------------------

  createThread(title = "New job"): Thread {
    const thread: Thread = {
      id: randomUUID().slice(0, 8),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.threads.set(thread.id, thread);
    void this.store.saveThread(thread);
    return thread;
  }

  getThread(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  listThreads(): Thread[] {
    return [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  activeThread(): Thread {
    const latest = this.listThreads()[0];
    return latest ?? this.createThread("Yard floor");
  }

  // ---- The main gate -----------------------------------------------------

  /**
   * Post a user message to a thread and run the crew.
   * Routing: explicit @mentions win; otherwise the first crew member
   * (the foreman by default) takes it.
   * Returns once the whole orchestration chain settles.
   */
  async send(threadId: string, text: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread: ${threadId}`);
    if (this.busy) throw new Error("yard is busy — one job at a time (v1)");

    const mentioned = this.resolveMentions(text);
    const responders = mentioned.length > 0 ? mentioned : [this.crew[0]!.tag];

    const userMsg: ThreadMessage = {
      id: randomUUID(),
      from: "user",
      to: responders,
      text,
      ts: Date.now(),
      depth: 0,
    };
    thread.messages.push(userMsg);
    thread.updatedAt = Date.now();
    await this.store.saveThread(thread);

    this.busy = true;
    try {
      for (const tag of responders) {
        const agent = this.agent(tag);
        if (!agent) continue;
        await this.runAgentTurn(agent, `[from user] ${text}`, thread.id, 0);
      }
    } finally {
      this.busy = false;
      for (const a of this.crew) {
        if (this.getPresence(a.tag) !== "escalated") this.setPresence(a.tag, "idle");
      }
    }
  }

  private resolveMentions(text: string): string[] {
    const tags = new Set<string>();
    for (const match of text.matchAll(/@([A-Za-z0-9_-]+)/g)) {
      if (this.agent(match[1]!)) tags.add(match[1]!.toLowerCase());
    }
    return [...tags];
  }

  // ---- One agent turn ----------------------------------------------------

  private async runAgentTurn(
    agent: AgentDef,
    input: string,
    threadId: string,
    depth: number,
    delegator?: string,
  ): Promise<ThreadMessage | undefined> {
    const thread = this.threads.get(threadId)!;
    this.setPresence(agent.tag, "working");

    // History snapshot excludes the input we're about to send; the caller
    // already appended user/handoff messages before invoking us.
    const messages: ModelMessage[] = [
      { role: "system", content: buildSystemPrompt(agent, this.crew, delegator) },
      ...historyToMessages(thread.messages, agent.tag),
      { role: "user", content: input },
    ];

    let text = "";
    let meta: TurnMeta = {};
    const failoversAtStart = this.failoverCounter.count;

    try {
      const specs = agent.tools
        .map((name) => TOOLS[name])
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const tools: ToolDefinition[] = specs.map((s) => s.def);
      const ctx: ToolContext = { workdir: this.store.workdir, agentTag: agent.tag };

      if (specs.length === 0) {
        // Plain streaming turn — no tools to wrangle. autoMode fails over
        // transparently before the first chunk, so we just count switches.
        const stream = await this.mh.stream({
          provider: agent.provider,
          model: agent.model,
          messages,
          temperature: agent.temperature,
        });
        for await (const chunk of stream) {
          if (chunk.type === "text-delta") {
            text += chunk.text;
            this.emitEvent({ type: "delta", threadId, agentTag: agent.tag, text: chunk.text });
          } else if (chunk.type === "finish") {
            meta.usage = chunk.usage;
          }
        }
      } else {
        for await (const ev of runToolLoop(this.mh, { provider: agent.provider, model: agent.model, messages, tools, temperature: agent.temperature }, (name, args) => this.executeTool(agent, name, args, ctx), { maxTurns: agent.maxTurns ?? 8 })) {
          if (ev.type === "chunk" && ev.chunk.type === "text-delta") {
            this.emitEvent({ type: "delta", threadId, agentTag: agent.tag, text: ev.chunk.text });
          } else if (ev.type === "tool") {
            this.emitEvent({
              type: "tool",
              threadId,
              agentTag: agent.tag,
              name: ev.call.name,
              args: ev.call.arguments,
            });
          } else if (ev.type === "done") {
            text = ev.messages.filter((m) => m.role === "assistant").at(-1)?.content as string ?? "";
            meta = { turns: ev.turns, usage: ev.usage };
          }
        }
      }
    } catch (err) {
      const detail = isModelHitchError(err)
        ? `model error [${err.code}]: ${err.message}`
        : (err as Error).message;
      this.setPresence(agent.tag, "error");
      this.emitEvent({ type: "error", threadId, agentTag: agent.tag, error: detail });
      return this.recordTurn(thread, agent, `⚠ ${detail}`, depth, {});
    }

    meta.failedOver = this.failoverCounter.count > failoversAtStart;

    // Parse the A2A directives out of the raw reply.
    const parsed = parseReply(text, agent.tag);
    const message = this.recordTurn(thread, agent, parsed.clean || "(no output)", depth, meta, parsed.handoff, parsed.escalation);

    // Escalation stops the chain — human gets paged.
    if (parsed.escalation) {
      this.setPresence(agent.tag, "escalated");
      this.emitEvent({ type: "escalate", threadId, escalation: parsed.escalation });
      return message;
    }

    // Handoff: mechanically execute the next leg, depth-capped.
    if (parsed.handoff && depth < this.config.maxDepth) {
      const next = this.agent(parsed.handoff.to);
      if (!next || next.tag === agent.tag) {
        this.setPresence(agent.tag, "idle");
        return message;
      }
      this.setPresence(agent.tag, "handoff");
      this.setPresence(next.tag, "working");
      this.emitEvent({ type: "handoff", threadId, handoff: parsed.handoff });

      const handoffMsg: ThreadMessage = {
        id: randomUUID(),
        from: agent.tag,
        to: [next.tag],
        text: `→ handed off to @${next.tag}: ${parsed.handoff.task}`,
        handoff: parsed.handoff,
        ts: Date.now(),
        depth,
      };
      thread.messages.push(handoffMsg);

      await this.runAgentTurn(next, `[Handed off by @${agent.tag}] ${parsed.handoff.task}`, threadId, depth + 1, agent.tag);
    }

    return message;
  }

  private recordTurn(
    thread: Thread,
    agent: AgentDef,
    text: string,
    depth: number,
    meta: TurnMeta,
    handoff?: Handoff,
    escalation?: Escalation,
  ): ThreadMessage {
    const message: ThreadMessage = {
      id: randomUUID(),
      from: agent.tag,
      text,
      ts: Date.now(),
      depth,
      meta,
      ...(handoff ? { handoff } : {}),
      ...(escalation ? { escalation } : {}),
    };
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    void this.store.saveThread(thread);
    this.emitEvent({ type: "turn:end", threadId: thread.id, message });
    return message;
  }

  // ---- Tools + approval gate ----------------------------------------------

  /** Override in a frontend to prompt humans instead of blocking heavy tools. */
  approveTool: (agentTag: string, name: string, args: Record<string, unknown>) => Promise<boolean> =
    async (_tag, name) => !needsApproval(name) || this.config.autoApproveTools;

  private async executeTool(
    agent: AgentDef,
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const spec = TOOLS[name];
    if (!spec) return `error: unknown tool "${name}"`;
    if (!(await this.approveTool(agent.tag, name, args))) {
      return "error: the human declined this tool call";
    }
    try {
      return await spec.execute(args, ctx);
    } catch (err) {
      return `error: ${(err as Error).message}`;
    }
  }

  // ---- Plumbing -----------------------------------------------------------

  private emitEvent(event: YardDogEvent): void {
    this.emit("event", event);
  }
}
