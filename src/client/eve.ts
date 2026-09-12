/**
 * Thin Eve HTTP client for YardDog's Bun CLI / OpenTUI.
 *
 * Speaks the Eve channel wire protocol (`/eve/v1/*`) with fetch + NDJSON —
 * no `eve` npm dependency on the Bun package (Eve host stays Node 24+ under
 * `hosted/`). See https://eve.dev/docs/channels/eve
 */

export interface EveClientOptions {
  /** Base URL where Eve routes are mounted (e.g. http://127.0.0.1:2000). */
  host: string;
  /** Optional bearer token (deployment protection / custom auth). */
  bearer?: string | (() => string | Promise<string>);
  /** Extra headers (e.g. x-vercel-protection-bypass). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Injected fetch (tests). */
  fetch?: typeof globalThis.fetch;
}

export interface EveHealth {
  ok: boolean;
  status?: string;
  workflowId?: string;
  raw: unknown;
}

export interface EveAskResult {
  sessionId: string;
  /** Concatenated assistant-visible text from the turn. */
  text: string;
  /** Raw NDJSON events collected while waiting for the turn to settle. */
  events: EveStreamEvent[];
}

export type EveStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export class EveClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "EveClientError";
  }
}

export class EveClient {
  readonly host: string;
  private readonly bearer?: EveClientOptions["bearer"];
  private readonly extraHeaders?: EveClientOptions["headers"];
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: EveClientOptions) {
    this.host = options.host.replace(/\/+$/, "");
    this.bearer = options.bearer;
    this.extraHeaders = options.headers;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async buildHeaders(
    init?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(init ?? {}),
    };
    if (this.extraHeaders) {
      const extra =
        typeof this.extraHeaders === "function"
          ? await this.extraHeaders()
          : this.extraHeaders;
      Object.assign(headers, extra);
    }
    if (this.bearer) {
      const token =
        typeof this.bearer === "function" ? await this.bearer() : this.bearer;
      if (token) headers.authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async health(): Promise<EveHealth> {
    const res = await this.fetchImpl(`${this.host}/eve/v1/health`, {
      method: "GET",
      headers: await this.buildHeaders(),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new EveClientError(
        `Eve health check failed (${res.status})`,
        res.status,
        body,
      );
    }
    let raw: unknown = {};
    try {
      raw = body ? JSON.parse(body) : {};
    } catch {
      raw = { body };
    }
    const obj = raw as Record<string, unknown>;
    return {
      ok: obj.ok === true || res.ok,
      status: typeof obj.status === "string" ? obj.status : undefined,
      workflowId:
        typeof obj.workflowId === "string" ? obj.workflowId : undefined,
      raw,
    };
  }

  /**
   * Probe whether the Eve host looks ready for sessions.
   * Returns false on network / non-2xx instead of throwing (for auto fallback).
   */
  async isReady(): Promise<boolean> {
    try {
      const h = await this.health();
      return h.ok;
    } catch {
      return false;
    }
  }

  async info(): Promise<unknown> {
    const res = await this.fetchImpl(`${this.host}/eve/v1/info`, {
      method: "GET",
      headers: await this.buildHeaders(),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new EveClientError(`Eve info failed (${res.status})`, res.status, body);
    }
    return body ? JSON.parse(body) : {};
  }

  /**
   * Create a session with the first user message and wait until the turn settles.
   */
  async ask(message: string): Promise<EveAskResult> {
    const res = await this.fetchImpl(`${this.host}/eve/v1/session`, {
      method: "POST",
      headers: await this.buildHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ message }),
    });
    const bodyText = await res.text();
    if (!res.ok && res.status !== 202) {
      throw new EveClientError(
        `Eve session create failed (${res.status})`,
        res.status,
        bodyText,
      );
    }

    let sessionId =
      res.headers.get("x-eve-session-id") ??
      res.headers.get("x-session-id") ??
      undefined;
    let parsed: Record<string, unknown> = {};
    if (bodyText) {
      try {
        parsed = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
    if (!sessionId && typeof parsed.sessionId === "string") {
      sessionId = parsed.sessionId;
    }
    if (!sessionId) {
      throw new EveClientError(
        "Eve session create returned no sessionId",
        res.status,
        bodyText,
      );
    }

    const events = await this.collectUntilSettled(sessionId);
    return {
      sessionId,
      text: extractAssistantText(events),
      events,
    };
  }

  /**
   * Follow-up message on an existing session; waits for the turn to settle.
   */
  async send(sessionId: string, message: string): Promise<EveAskResult> {
    const res = await this.fetchImpl(
      `${this.host}/eve/v1/session/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: await this.buildHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ message }),
      },
    );
    const bodyText = await res.text();
    if (!res.ok && res.status !== 202) {
      throw new EveClientError(
        `Eve session send failed (${res.status})`,
        res.status,
        bodyText,
      );
    }
    const events = await this.collectUntilSettled(sessionId);
    return {
      sessionId,
      text: extractAssistantText(events),
      events,
    };
  }

  /**
   * Stream NDJSON events from `GET /eve/v1/session/:id/stream`.
   * Stops when the session is waiting / completed / error, or the stream ends.
   */
  async *stream(
    sessionId: string,
    opts: { follow?: boolean; signal?: AbortSignal } = {},
  ): AsyncGenerator<EveStreamEvent> {
    const url = new URL(
      `${this.host}/eve/v1/session/${encodeURIComponent(sessionId)}/stream`,
    );
    if (opts.follow === false) url.searchParams.set("follow", "false");

    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: await this.buildHeaders({ accept: "application/x-ndjson" }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new EveClientError(
        `Eve stream failed (${res.status})`,
        res.status,
        body,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            yield JSON.parse(trimmed) as EveStreamEvent;
          } catch {
            yield { type: "raw", line: trimmed };
          }
        }
      }
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer.trim()) as EveStreamEvent;
        } catch {
          yield { type: "raw", line: buffer.trim() };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async collectUntilSettled(
    sessionId: string,
    timeoutMs = 120_000,
  ): Promise<EveStreamEvent[]> {
    const events: EveStreamEvent[] = [];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      for await (const event of this.stream(sessionId, { signal: ac.signal })) {
        events.push(event);
        if (isSettledEvent(event)) break;
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new EveClientError(
          `Eve session ${sessionId} timed out after ${timeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return events;
  }
}

function isSettledEvent(event: EveStreamEvent): boolean {
  const t = event.type;
  return (
    t === "session.waiting" ||
    t === "session.completed" ||
    t === "session.error" ||
    t === "run.completed" ||
    t === "run.failed" ||
    t === "error"
  );
}

/** Best-effort extraction of assistant text from heterogeneous Eve stream events. */
export function extractAssistantText(events: EveStreamEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    const t = event.type;
    if (
      t === "message.delta" ||
      t === "text.delta" ||
      t === "agent.message.delta"
    ) {
      const delta =
        (typeof event.delta === "string" && event.delta) ||
        (typeof event.text === "string" && event.text) ||
        (typeof (event as unknown as { content?: unknown }).content === "string" &&
          (event as unknown as { content: string }).content) ||
        "";
      if (delta) parts.push(delta);
      continue;
    }
    if (
      t === "message" ||
      t === "agent.message" ||
      t === "message.completed"
    ) {
      const text =
        (typeof event.text === "string" && event.text) ||
        (typeof event.message === "string" && event.message) ||
        (typeof (event as unknown as { content?: unknown }).content === "string" &&
          (event as unknown as { content: string }).content) ||
        "";
      if (text) parts.push(text);
    }
  }
  if (parts.length > 0) return parts.join("");

  // Fallback: last event with a string `message` field
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (typeof e.message === "string" && e.message.trim()) return e.message;
    if (typeof e.text === "string" && e.text.trim()) return e.text;
  }
  return "";
}
