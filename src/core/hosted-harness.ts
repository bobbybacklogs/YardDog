/**
 * HostedYardDog — Eve-facing harness (Phase 2).
 *
 * Crew, directives, tools, approval, and memory with the same semantics as the
 * Bun YardDog engine, but every model turn uses YardDog-owned AiSdkAdapter
 * (Vercel AI Gateway). ModelHitch is never imported on this path.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { jsonSchema, stepCountIs, streamText, tool } from "ai";
import { parseReply } from "./directives";
import { buildSystemPrompt, historyToMessages } from "./prompts";
import { Store, type HarnessConfig } from "./store";
import { TOOLS, needsApproval, type ToolContext } from "./tools";
import { defaultCrew } from "./crew";
import { applyMemory } from "./memory";
import { Computer } from "../workspace/computer";
import {
  AiSdkAdapter,
  getLaneModel,
  resolveModelLane,
  type ChatMessage,
  type ModelLane,
  type TurnUsage,
} from "../model";
import type {
  AgentDef,
  Consult,
  Escalation,
  Handoff,
  Presence,
  Thread,
  ThreadMessage,
  TurnMeta,
  YardDogEvent,
} from "./types";

export interface HostedYardDogOptions {
  /** Tool + persistence confinement root. Default: cwd. */
  workdir?: string;
  /** Prebuilt AI SDK adapter (tests / custom lane config). */
  adapter?: AiSdkAdapter;
  /** Override harness config after load. */
  config?: Partial<HarnessConfig>;
  /** Inject the model turn (unit tests). */
  runModelTurn?: HostedModelTurn;
}

export type HostedModelTurn = (args: {
  agent: AgentDef;
  messages: ChatMessage[];
  toolNames: string[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxTurns: number;
  onDelta?: (text: string) => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
}) => Promise<{
  text: string;
  modelId?: string;
  lane?: ModelLane;
  usage?: TurnUsage;
  turns?: number;
}>;

const MAX_CONSULTS_PER_JOB = 4;

export class HostedYardDog extends EventEmitter {
  readonly store: Store;
  readonly adapter: AiSdkAdapter;
  config: HarnessConfig;

  private crew: AgentDef[] = [];
  private threads = new Map<string, Thread>();
  private presence = new Map<string, Presence>();
  private busy = false;
  private consultBudget = { remaining: 0 };
  private computers = new Map<string, Computer>();
  private jobQueueTail: Promise<void> = Promise.resolve();
  private queuedJobs = 0;
  private readonly runModelTurn: HostedModelTurn;

  private constructor(
    store: Store,
    config: HarnessConfig,
    adapter: AiSdkAdapter,
    runModelTurn: HostedModelTurn,
  ) {
    super();
    this.store = store;
    this.config = config;
    this.adapter = adapter;
    this.runModelTurn = runModelTurn;
  }

  static async create(options: HostedYardDogOptions = {}): Promise<HostedYardDog> {
    const workdir = options.workdir ?? process.cwd();
    const store = new Store(workdir);
    await store.init();

    const loaded = await store.loadConfig();
    const config: HarnessConfig = { ...loaded, ...options.config };
    await store.saveConfig(config);

    const adapter = options.adapter ?? new AiSdkAdapter();
    const runModelTurn = options.runModelTurn ?? defaultHostedModelTurn(adapter);

    const dog = new HostedYardDog(store, config, adapter, runModelTurn);
    const existingCrew = await store.loadCrew();
    dog.crew = existingCrew ?? defaultCrew();
    if (!existingCrew) await store.saveCrew(dog.crew);

    for (const thread of await store.loadThreads()) dog.threads.set(thread.id, thread);
    for (const agent of dog.crew) dog.presence.set(agent.tag, "idle");
    return dog;
  }

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

  get pending(): number {
    return this.queuedJobs;
  }

  createThread(title = "Yard floor"): Thread {
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
    return this.listThreads()[0] ?? this.createThread("Yard floor");
  }

  /**
   * Post a user message and run the hosted crew.
   * `@delegate` / `@consult` / `@escalate` are parsed and executed here.
   */
  async send(threadId: string, text: string): Promise<Thread> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread: ${threadId}`);

    this.queuedJobs++;
    const run = this.jobQueueTail.then(() => this.runJob(thread, text));
    this.jobQueueTail = run.catch(() => {
      /* keep queue alive */
    });
    void run.finally(() => {
      this.queuedJobs--;
    });
    await run;
    return thread;
  }

  private async runJob(thread: Thread, text: string): Promise<void> {
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
    this.consultBudget.remaining = MAX_CONSULTS_PER_JOB;
    try {
      await Promise.all(
        responders.map((tag) => {
          const agent = this.agent(tag);
          if (!agent) return Promise.resolve();
          return this.runAgentTurn(agent, `[from user] ${text}`, thread.id, 0);
        }),
      );
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

  private async runAgentTurn(
    agent: AgentDef,
    input: string,
    threadId: string,
    depth: number,
    delegator?: string,
    opts?: { ignoreDirectives?: boolean },
  ): Promise<ThreadMessage | undefined> {
    const ignoreDirectives = opts?.ignoreDirectives === true;
    const thread = this.threads.get(threadId)!;
    this.setPresence(agent.tag, "working");
    this.emitEvent({
      type: "turn:start",
      threadId,
      agentTag: agent.tag,
      input,
      depth,
    });

    const systemPrompt = buildSystemPrompt(agent, this.crew, delegator);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...historyToMessages(thread.messages, agent.tag),
      { role: "user", content: input },
    ];

    let text = "";
    let meta: TurnMeta = {};

    const ctx: ToolContext = {
      workdir: this.store.workdir,
      agentTag: agent.tag,
      computer: agent.tools.includes("shell")
        ? await this.computerFor(agent.tag)
        : undefined,
      remember: (mode, note) => this.writeMemory(agent, mode, note),
    };

    try {
      const result = await this.runModelTurn({
        agent,
        messages,
        toolNames: agent.tools.filter((n) => Boolean(TOOLS[n])),
        executeTool: (name, args) => this.executeTool(agent, name, args, ctx),
        maxTurns: agent.maxTurns ?? 8,
        onDelta: (delta) => {
          this.emitEvent({ type: "delta", threadId, agentTag: agent.tag, text: delta });
        },
        onTool: (name, args) => {
          this.emitEvent({ type: "tool", threadId, agentTag: agent.tag, name, args });
        },
      });
      text = result.text;
      meta = {
        servedModel: result.modelId,
        turns: result.turns,
        usage: result.usage as TurnMeta["usage"],
      };
    } catch (err) {
      const detail = (err as Error).message;
      this.setPresence(agent.tag, "error");
      this.emitEvent({ type: "error", threadId, agentTag: agent.tag, error: detail });
      return this.recordTurn(thread, agent, `⚠ ${detail}`, depth, {});
    }

    const parsed = ignoreDirectives
      ? {
          clean: text,
          handoffs: [] as Handoff[],
          consult: undefined,
          escalation: undefined,
        }
      : parseReply(text, agent.tag);

    const message = this.recordTurn(
      thread,
      agent,
      parsed.clean || "(no output)",
      depth,
      meta,
      parsed.handoffs,
      parsed.consult,
      parsed.escalation,
    );

    if (parsed.escalation) {
      this.setPresence(agent.tag, "escalated");
      this.emitEvent({ type: "escalate", threadId, escalation: parsed.escalation });
      return message;
    }

    if (parsed.consult && this.consultBudget.remaining > 0) {
      const target = this.agent(parsed.consult.to);
      if (target && target.tag !== agent.tag) {
        this.consultBudget.remaining--;
        this.setPresence(agent.tag, "handoff");
        this.emitEvent({ type: "consult", threadId, consult: parsed.consult });

        thread.messages.push({
          id: randomUUID(),
          from: agent.tag,
          to: [target.tag],
          text: `? consulted @${target.tag}: ${parsed.consult.question}`,
          consult: parsed.consult,
          ts: Date.now(),
          depth,
        });
        await this.store.saveThread(thread);

        const answerMsg = await this.runAgentTurn(
          target,
          `[Consult from @${agent.tag}] ${parsed.consult.question}\n\nAnswer concisely in-thread. Directives are ignored during consults — just answer.`,
          threadId,
          depth + 1,
          undefined,
          { ignoreDirectives: true },
        );

        if (answerMsg) {
          await this.runAgentTurn(
            agent,
            `[Consult answer from @${target.tag}] ${answerMsg.text}\n\nContinue your job with this in mind.`,
            threadId,
            depth + 1,
            delegator,
          );
        }
        return message;
      }
    }

    if (parsed.handoffs.length > 0 && depth < this.config.maxDepth) {
      this.setPresence(agent.tag, "handoff");

      const valid = parsed.handoffs
        .map((h) => ({ h, next: this.agent(h.to) }))
        .filter(
          (x): x is { h: Handoff; next: AgentDef } =>
            x.next !== undefined &&
            x.next.tag !== agent.tag &&
            x.h.to !== delegator?.toLowerCase(),
        );

      if (valid.length > 0) {
        for (const { h } of valid) {
          this.emitEvent({ type: "handoff", threadId, handoff: h });
        }
        thread.messages.push({
          id: randomUUID(),
          from: agent.tag,
          to: valid.map((v) => v.h.to),
          text:
            valid.length === 1
              ? `→ handed off to @${valid[0]!.h.to}: ${valid[0]!.h.task}`
              : `→ handed off to ${valid.length} teammates in parallel:\n` +
                valid.map((v) => `  • @${v.h.to}: ${v.h.task}`).join("\n"),
          handoffs: valid.map((v) => v.h),
          ts: Date.now(),
          depth,
        });
        await this.store.saveThread(thread);

        await Promise.all(
          valid.map(({ h, next }) =>
            this.runAgentTurn(
              next,
              `[Handed off by @${agent.tag}] ${h.task}`,
              threadId,
              depth + 1,
              agent.tag,
            ),
          ),
        );
      }
    }

    return message;
  }

  private recordTurn(
    thread: Thread,
    agent: AgentDef,
    text: string,
    depth: number,
    meta: TurnMeta,
    handoffs?: Handoff[],
    consult?: Consult,
    escalation?: Escalation,
  ): ThreadMessage {
    const message: ThreadMessage = {
      id: randomUUID(),
      from: agent.tag,
      text,
      ts: Date.now(),
      depth,
      meta,
      ...(handoffs && handoffs.length > 0 ? { handoffs } : {}),
      ...(consult ? { consult } : {}),
      ...(escalation ? { escalation } : {}),
    };
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    void this.store.saveThread(thread);
    this.emitEvent({ type: "turn:end", threadId: thread.id, message });
    return message;
  }

  /** Override from Eve / frontends to prompt humans on heavy tools. */
  approveTool: (
    agentTag: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean> = async (_tag, name) =>
    !needsApproval(name) || this.config.autoApproveTools;

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

  private async computerFor(tag: string): Promise<Computer> {
    let computer = this.computers.get(tag);
    if (!computer) {
      computer = await Computer.create(tag, this.store.workdir, this.store.dir);
      this.computers.set(tag, computer);
    }
    return computer;
  }

  private async writeMemory(
    agent: AgentDef,
    mode: "append" | "replace",
    note: string,
  ): Promise<string> {
    applyMemory(agent, mode, note);
    if (!agent.temp) await this.store.saveCrew(this.crew);
    return mode === "replace" ? "memory replaced" : "remembered";
  }

  private emitEvent(event: YardDogEvent): void {
    this.emit("event", event);
  }
}

function defaultHostedModelTurn(adapter: AiSdkAdapter): HostedModelTurn {
  return async ({
    agent,
    messages,
    toolNames,
    executeTool,
    maxTurns,
    onDelta,
    onTool,
  }) => {
    if (toolNames.length === 0) {
      let text = "";
      let modelId: string | undefined;
      let lane: ModelLane | undefined;
      let usage: TurnUsage | undefined;
      for await (const chunk of adapter.streamTurn({
        messages,
        role: agent.tag,
        temperature: agent.temperature,
      })) {
        if (chunk.type === "lane") {
          lane = chunk.lane;
          modelId = chunk.modelId;
        } else if (chunk.type === "text-delta") {
          text += chunk.text;
          onDelta?.(chunk.text);
        } else if (chunk.type === "finish") {
          text = chunk.text || text;
          modelId = chunk.modelId;
          lane = chunk.lane;
          usage = chunk.usage;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }
      return { text, modelId, lane, usage, turns: 1 };
    }

    const prompt = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    const { lane } = resolveModelLane({ role: agent.tag, prompt });
    const resolved = getLaneModel(lane, {});
    const pool = resolved.modelPool;

    const aiTools: Record<string, ReturnType<typeof tool>> = {};
    for (const name of toolNames) {
      const spec = TOOLS[name];
      if (!spec) continue;
      const parameters =
        (spec.def as { parameters?: Record<string, unknown> }).parameters ??
        ({ type: "object", properties: {} } as Record<string, unknown>);
      aiTools[name] = tool({
        description: spec.def.description ?? name,
        inputSchema: jsonSchema(parameters),
        execute: async (args) => {
          const record = args as Record<string, unknown>;
          onTool?.(name, record);
          return executeTool(name, record);
        },
      });
    }

    let lastError: unknown;
    for (let i = 0; i < pool.length; i++) {
      const modelId = pool[i]!;
      try {
        const result = streamText({
          model: modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          tools: aiTools,
          temperature: agent.temperature,
          stopWhen: stepCountIs(maxTurns),
        });

        let text = "";
        for await (const delta of result.textStream) {
          text += delta;
          onDelta?.(delta);
        }
        const finalText = (await result.text) || text;
        const usageRaw = await result.usage;
        return {
          text: finalText,
          modelId,
          lane,
          usage: usageRaw
            ? {
                inputTokens: usageRaw.inputTokens,
                outputTokens: usageRaw.outputTokens,
                totalTokens: usageRaw.totalTokens,
              }
            : undefined,
          turns: maxTurns,
        };
      } catch (err) {
        lastError = err;
        if (i === pool.length - 1) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}
