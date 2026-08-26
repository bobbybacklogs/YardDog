import type { Usage } from "modelhitch";

/** Lifecycle state of an agent, surfaced in the TUI fleet view. */
export type Presence = "idle" | "working" | "handoff" | "escalated" | "error";

/**
 * A YardDog agent definition. Pure data — JSON-safe, persisted as-is.
 * ModelHitch exclusively owns provider/model routing for every agent.
 */
export interface AgentDef {
  id: string;
  /** Crew handle, without the leading "@". Lowercase word characters/dashes. */
  tag: string;
  name: string;
  role: string;
  description?: string;
  systemPrompt: string;
  temperature?: number;
  /** Max tool-loop turns for this agent (default 8). */
  maxTurns?: number;
  /** Durable self-authored notes, injected into every turn across sessions. */
  memory: string;
  /** Names of allowed tools from the built-in registry. Empty = no tools. */
  tools: string[];
  /** Present when this worker was hired from a local agent directory. */
  temp?: {
    vendor: string;
    sourcePath: string;
    hiredAt: number;
  };
}

export interface Handoff {
  from: string;
  to: string;
  task: string;
}

/** A judgment call routed to another agent (usually the foreman) mid-job. */
export interface Consult {
  from: string;
  to: string;
  question: string;
}

export interface Escalation {
  from: string;
  question: string;
}

export interface TurnMeta {
  servedProvider?: string;
  servedModel?: string;
  turns?: number;
  usage?: Usage;
  failedOver?: boolean;
}

/** One entry in a thread's transcript (directives already stripped from text). */
export interface ThreadMessage {
  id: string;
  /** "user" or an agent tag. */
  from: string;
  /** Agent tags addressed by @mention, when known. */
  to?: string[];
  text: string;
  /** Handoffs emitted by this message (usually 0 or 1; up to 3 with parallels). */
  handoffs?: Handoff[];
  consult?: Consult;
  escalation?: Escalation;
  ts: number;
  /** Orchestration depth this message was produced at (0 = direct reply). */
  depth: number;
  /** Skill names attached to this job (user messages only). */
  skills?: string[];
  meta?: TurnMeta;
}

export interface Thread {
  id: string;
  title: string;
  messages: ThreadMessage[];
  createdAt: number;
  updatedAt: number;
}

export type YardDogEvent =
  | { type: "presence"; tag: string; presence: Presence }
  | { type: "turn:start"; threadId: string; agentTag: string; input: string; depth: number }
  | { type: "delta"; threadId: string; agentTag: string; text: string }
  | {
      type: "tool";
      threadId: string;
      agentTag: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: "turn:end"; threadId: string; message: ThreadMessage }
  | { type: "handoff"; threadId: string; handoff: Handoff }
  | { type: "consult"; threadId: string; consult: Consult }
  | { type: "escalate"; threadId: string; escalation: Escalation }
  | { type: "failover"; threadId?: string; agentTag?: string; detail: string }
  | { type: "error"; threadId?: string; agentTag?: string; error: string };
