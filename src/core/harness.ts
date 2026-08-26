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
import { slugifyTag, specToTempDef, tempRoots } from "./hall";
import { prepareSkills } from "./library";
import { Computer } from "../workspace/computer";
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
  /** Per-job consult budget — resets at each send(). */
  private consultBudget = { remaining: 0 };
  private static readonly MAX_CONSULTS_PER_JOB = 4;
  /** Prompt injection for the job's attached skills; set during send(). */
  private activeSkillInjection = "";
  /** Per-agent sandboxed computers, created on first shell use. */
  private computers: Map<string, Computer> = new Map();
  /** FIFO job queue: tail promise chains jobs so they never overlap. */
  private jobQueueTail: Promise<void> = Promise.resolve();
  private queuedJobs = 0;

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

  // ---- The hiring hall ----------------------------------------------------

  /** Temps currently on payroll this session. */
  temps(): AgentDef[] {
    return this.crew.filter((a) => a.temp !== undefined);
  }

  /**
   * Hire a discovered temp by name or tag (as listed by `yarddog temps`).
   * Session-scoped: never persisted to agents.json.
   */
  async hireTemp(nameOrTag: string, projectRoot?: string): Promise<{ def: AgentDef; notes: string[] }> {
    const roots = await tempRoots(projectRoot ?? this.store.workdir);
    const specs = await import("portage-cli").then((p) => p.discoverAgents(roots));
    const wanted = slugifyTag(nameOrTag);
    const spec = specs.find(
      (s) => slugifyTag(s.name) === wanted || s.name.toLowerCase() === nameOrTag.toLowerCase(),
    );
    if (!spec) throw new Error(`no temp named "${nameOrTag}" in the local agent directories`);
    if (this.agent(wanted)) throw new Error(`@${wanted} is already on the crew`);

    const { def, notes } = specToTempDef(spec);
    // Empty provider/model means "ride the config lane" — fill them so
    // ModelHitch calls stay uniform.
    if (!def.provider) {
      def.provider = this.config.provider;
      def.model = this.config.model;
    }
    this.crew.push(def);
    this.presence.set(def.tag, "idle");
    return { def, notes };
  }

  fireTemp(tag: string): boolean {
    const idx = this.crew.findIndex((a) => a.tag === tag.toLowerCase() && a.temp !== undefined);
    if (idx === -1) return false;
    const [removed] = this.crew.splice(idx, 1);
    this.presence.delete(removed!.tag);
    return true;
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
   * `opts.skills` attaches library skills to this job — their instructions
   * are injected into every participating agent's system prompt.
   * Jobs are FIFO-queued: send() resolves when ITS job completes, even if
   * other jobs are still ahead of it.
   */
  async send(
    threadId: string,
    text: string,
    opts?: { skills?: string[] },
  ): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread: ${threadId}`);

    // Resolve + stage skills up front so a bad name fails before queueing.
    const skillNames = opts?.skills ?? [];
    const { injection } = await prepareSkills(skillNames, this.store.workdir);

    this.queuedJobs++;
    const run = this.jobQueueTail.then(() =>
      this.runJob(thread, text, injection, skillNames),
    );
    this.jobQueueTail = run.catch(() => {
      /* keep the queue chain alive; the caller's promise still rejects */
    });
    void run.finally(() => {
      this.queuedJobs--;
    });
    return run;
  }

  get pending(): number {
    return this.queuedJobs;
  }

  /** One job's full execution: transcript entry → responders → orchestration. */
  private async runJob(
    thread: Thread,
    text: string,
    injection: string,
    skillNames: string[],
  ): Promise<void> {
    const mentioned = this.resolveMentions(text);
    const responders = mentioned.length > 0 ? mentioned : [this.crew[0]!.tag];

    const userMsg: ThreadMessage = {
      id: randomUUID(),
      from: "user",
      to: responders,
      text,
      ts: Date.now(),
      depth: 0,
      ...(skillNames.length > 0 ? { skills: skillNames } : {}),
    };
    thread.messages.push(userMsg);
    thread.updatedAt = Date.now();
    await this.store.saveThread(thread);

    this.busy = true;
    this.activeSkillInjection = injection;
    this.consultBudget.remaining = YardDog.MAX_CONSULTS_PER_JOB;
    try {
      // Multiple @mentions fan out in parallel — each mentioned agent takes
      // the job simultaneously (Grok Bot: many bots, one thread).
      await Promise.all(
        responders.map((tag) => {
          const agent = this.agent(tag);
          if (!agent) return Promise.resolve();
          return this.runAgentTurn(agent, `[from user] ${text}`, thread.id, 0);
        }),
      );
    } finally {
      this.busy = false;
      this.activeSkillInjection = "";
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
    opts?: { ignoreDirectives?: boolean },
  ): Promise<ThreadMessage | undefined> {
    const ignoreDirectives = opts?.ignoreDirectives === true;
    const thread = this.threads.get(threadId)!;
    this.setPresence(agent.tag, "working");

    // History snapshot excludes the input we're about to send; the caller
    // already appended user/handoff messages before invoking us.
    const systemPrompt = buildSystemPrompt(agent, this.crew, delegator);
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: this.activeSkillInjection
          ? `${systemPrompt}\n\n${this.activeSkillInjection}`
          : systemPrompt,
      },
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
      const ctx: ToolContext = {
        workdir: this.store.workdir,
        agentTag: agent.tag,
        computer: agent.tools.includes("shell")
          ? await this.computerFor(agent.tag)
          : undefined,
      };

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

    // Consult-answer turns skip directive parsing: an answer is an answer,
    // not a delegation opportunity (keeps consult chains from compounding).
    const parsed = ignoreDirectives
      ? { clean: text, handoffs: [] as Handoff[], consult: undefined, escalation: undefined }
      : parseReply(text, agent.tag);
    const message = this.recordTurn(thread, agent, parsed.clean || "(no output)", depth, meta, parsed.handoffs, parsed.consult, parsed.escalation);

    // Escalation stops the chain — human gets paged.
    if (parsed.escalation) {
      this.setPresence(agent.tag, "escalated");
      this.emitEvent({ type: "escalate", threadId, escalation: parsed.escalation });
      return message;
    }

    // Consult: ask another crew member in-thread. The answer flows back and
    // the asker continues its job. Budget-capped per job to keep chains sane.
    if (parsed.consult && this.consultBudget.remaining > 0) {
      const target = this.agent(parsed.consult.to);
      if (target && target.tag !== agent.tag) {
        this.consultBudget.remaining--;
        this.setPresence(agent.tag, "handoff");
        this.emitEvent({ type: "consult", threadId, consult: parsed.consult });

        const consultMsg: ThreadMessage = {
          id: randomUUID(),
          from: agent.tag,
          to: [target.tag],
          text: `? consulted @${target.tag}: ${parsed.consult.question}`,
          consult: parsed.consult,
          ts: Date.now(),
          depth,
        };
        thread.messages.push(consultMsg);
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

    // Handoffs: mechanically execute the next legs — siblings in PARALLEL,
    // depth-capped. The no-return rule still applies per leg.
    if (parsed.handoffs.length > 0 && depth < this.config.maxDepth) {
      this.setPresence(agent.tag, "handoff");

      const valid = parsed.handoffs
        .map((h) => ({ h, next: this.agent(h.to) }))
        .filter(
          (x): x is { h: Handoff; next: AgentDef } =>
            x.next !== undefined && x.next.tag !== agent.tag && x.h.to !== delegator?.toLowerCase(),
        );

      if (valid.length > 0) {
        for (const { h } of valid) this.emitEvent({ type: "handoff", threadId, handoff: h });
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

  /** Lazily build (and cache) an agent's sandboxed computer. */
  private async computerFor(tag: string): Promise<Computer> {
    let computer = this.computers.get(tag);
    if (!computer) {
      computer = await Computer.create(tag, this.store.workdir, this.store.dir);
      this.computers.set(tag, computer);
    }
    return computer;
  }

  // ---- Plumbing -----------------------------------------------------------

  private emitEvent(event: YardDogEvent): void {
    this.emit("event", event);
  }
}
