/**
 * CursorPlane — YardDog-owned Cursor Cloud @delegate plane.
 *
 * Prefers @cursor/sdk (`Agent.create` + `send` + `stream`). Inject `createAgent` for tests.
 */

import { Agent } from "@cursor/sdk";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";
import {
  CURSOR_BAY_TAG,
  type CursorDispatchRequest,
  type CursorJob,
  type CursorJobStatus,
  type CursorPlaneEvent,
  type CursorRepoRef,
} from "./types";

export type CreateCursorAgent = (options: {
  apiKey: string;
  model?: { id: string };
  name?: string;
  cloud: {
    repos?: Array<{ url: string; startingRef?: string }>;
    autoCreatePR?: boolean;
  };
}) => Promise<SDKAgent>;

export interface CursorPlaneOptions {
  /** Defaults to CURSOR_API_KEY / CURSOR_API_KEY. */
  apiKey?: string;
  defaultRepos?: CursorRepoRef[];
  autoCreatePR?: boolean;
  modelId?: string;
  /** Inject Agent.create for unit tests (skips live API key requirement). */
  createAgent?: CreateCursorAgent;
}

function resolveApiKey(explicit?: string): string | undefined {
  return explicit || process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY || undefined;
}

function shortTag(agentId: string): string {
  const clean = agentId.replace(/^bc-/, "").replace(/[^a-zA-Z0-9]/g, "");
  return `cursor-${clean.slice(0, 8) || "job"}`;
}

export class CursorPlane {
  private readonly apiKey?: string;
  private readonly defaultRepos: CursorRepoRef[];
  private readonly autoCreatePR: boolean;
  private readonly modelId?: string;
  private readonly createAgent: CreateCursorAgent;
  private readonly mocked: boolean;
  private readonly jobs = new Map<string, CursorJob>();
  private readonly byTag = new Map<string, string>();
  private readonly agents = new Map<string, SDKAgent>();
  private readonly runs = new Map<string, Run>();

  constructor(options: CursorPlaneOptions = {}) {
    this.apiKey = resolveApiKey(options.apiKey);
    this.defaultRepos = options.defaultRepos ?? [];
    this.autoCreatePR = options.autoCreatePR ?? true;
    this.modelId = options.modelId;
    this.mocked = Boolean(options.createAgent);
    this.createAgent =
      options.createAgent ??
      (async (opts) =>
        Agent.create({
          apiKey: opts.apiKey,
          model: opts.model,
          name: opts.name,
          cloud: opts.cloud,
        }));
  }

  /** Live key present, or a test mock was injected. */
  get ready(): boolean {
    return this.mocked || Boolean(this.apiKey);
  }

  list(): CursorJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(idOrTag: string): CursorJob | undefined {
    const key = idOrTag.replace(/^@/, "");
    const byId = this.jobs.get(key);
    if (byId) return byId;
    const id = this.byTag.get(key.toLowerCase());
    return id ? this.jobs.get(id) : undefined;
  }

  async dispatch(
    request: CursorDispatchRequest,
    onEvent?: (event: CursorPlaneEvent) => void,
  ): Promise<CursorJob> {
    if (!this.ready) {
      throw new Error(
        "CURSOR_API_KEY (or CURSOR_API_KEY) is required to dispatch Cursor Cloud agents",
      );
    }
    const key = this.apiKey ?? "test-key";
    const repos = request.repos?.length ? request.repos : this.defaultRepos;
    const requestedTag = request.tag?.toLowerCase().replace(/^@/, "");
    const now = Date.now();
    const modelId = request.modelId ?? this.modelId;

    const agent = await this.createAgent({
      apiKey: key,
      model: modelId ? { id: modelId } : undefined,
      name: request.name ?? `YardDog @${requestedTag ?? CURSOR_BAY_TAG}`,
      cloud: {
        repos: repos.map((r) => ({
          url: r.url,
          startingRef: r.startingRef,
        })),
        autoCreatePR: request.autoCreatePR ?? this.autoCreatePR,
      },
    });

    const id = agent.agentId;
    const tag = requestedTag || CURSOR_BAY_TAG;
    const job: CursorJob = {
      id,
      tag,
      task: request.task,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    this.byTag.set(tag, id);
    // Also index a stable short tag so status/cancel can use cursor-<id>
    this.byTag.set(shortTag(id), id);
    this.agents.set(id, agent);
    this.emit(onEvent, job, "status");

    const run = await agent.send(request.task);
    job.runId = run.id;
    job.status = "running";
    job.updatedAt = Date.now();
    this.runs.set(id, run);
    this.emit(onEvent, job, "status");

    if (request.wait === false) return { ...job };

    try {
      for await (const message of run.stream()) {
        this.consumeStreamMessage(job, message, onEvent);
      }
      const result = await run.wait();
      job.status = mapRunStatus(result.status);
      if (!job.text?.trim() && result.result) job.text = result.result;
      job.error = result.error?.message;
      const pr = result.git?.branches?.map((b) => b.prUrl).find(Boolean);
      if (pr) job.prUrl = pr;
      const branch = result.git?.branches?.map((b) => b.branch).find(Boolean);
      if (branch) job.branch = branch;
      job.updatedAt = Date.now();
      this.emit(onEvent, job, job.status === "error" ? "error" : "finish", {
        text: job.text,
      });
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.updatedAt = Date.now();
      this.emit(onEvent, job, "error", { text: job.error });
      throw err;
    }

    return { ...job };
  }

  async status(idOrTag: string): Promise<CursorJob | undefined> {
    const job = this.get(idOrTag);
    if (!job) return undefined;
    const run = this.runs.get(job.id);
    if (run) {
      job.status = mapRunStatus(run.status);
      if (run.result) job.text = run.result;
      if (run.error) job.error = run.error.message;
      job.updatedAt = Date.now();
    }
    return { ...job };
  }

  async cancel(idOrTag: string): Promise<CursorJob | undefined> {
    const job = this.get(idOrTag);
    if (!job) return undefined;
    const run = this.runs.get(job.id);
    if (run && run.status === "running") {
      await run.cancel();
    }
    job.status = "cancelled";
    job.updatedAt = Date.now();
    return { ...job };
  }

  private consumeStreamMessage(
    job: CursorJob,
    message: SDKMessage,
    onEvent?: (event: CursorPlaneEvent) => void,
  ): void {
    job.updatedAt = Date.now();
    if (message.type === "assistant") {
      const text = message.message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text) {
        job.text = (job.text ?? "") + text;
        this.emit(onEvent, job, "delta", { text });
      }
      return;
    }
    if (message.type === "tool_call") {
      this.emit(onEvent, job, "tool", {
        toolName: message.name,
        toolArgs:
          message.args && typeof message.args === "object"
            ? (message.args as Record<string, unknown>)
            : {},
      });
      return;
    }
    if (message.type === "status") {
      const st = message.status.toLowerCase();
      if (st.includes("cancel")) job.status = "cancelled";
      else if (st.includes("error") || st.includes("expired")) job.status = "error";
      else if (st.includes("finish")) job.status = "finished";
      else job.status = "running";
      this.emit(onEvent, job, "status");
    }
  }

  private emit(
    onEvent: ((event: CursorPlaneEvent) => void) | undefined,
    job: CursorJob,
    kind: CursorPlaneEvent["kind"],
    extra?: { text?: string; toolName?: string; toolArgs?: Record<string, unknown> },
  ): void {
    onEvent?.({ job: { ...job }, kind, ...extra });
  }
}

function mapRunStatus(status: string): CursorJobStatus {
  switch (status) {
    case "running":
      return "running";
    case "finished":
      return "finished";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    default:
      return "finished";
  }
}
