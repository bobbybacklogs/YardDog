import { EveClient, type EveAskResult, type EveClientOptions } from "./eve";
import {
  resolveClientTarget,
  type ResolvedClientTarget,
  type YardClientModeOptions,
} from "./mode";
import { YardDog, type YardDogOptions } from "../core/harness";

export type YardRuntimeKind = "local" | "eve";

export interface OpenYardOptions extends YardClientModeOptions {
  workdir?: string;
  /** Forwarded to YardDog.create when running locally. */
  local?: YardDogOptions;
  /** Extra Eve client options (auth headers, fetch). */
  eve?: Omit<EveClientOptions, "host">;
  /**
   * When auto-mode Eve health fails, fall back to local.
   * Default: true if resolveClientTarget.allowLocalFallback.
   */
  fallbackToLocal?: boolean;
  /** Optional logger for mode / fallback notices. */
  log?: (line: string) => void;
}

export interface YardRuntime {
  kind: YardRuntimeKind;
  /** Human-readable explanation of how we got here. */
  reason: string;
  /** Eve host when kind === "eve". */
  eveUrl?: string;
  /** True if we fell back from Eve → local. */
  fellBack: boolean;
  /** Local harness (only when kind === "local"). */
  dog?: YardDog;
  /** Eve HTTP client (only when kind === "eve"). */
  eve?: EveClient;
  /** Durable Eve session id after the first ask (kind === "eve"). */
  eveSessionId?: string;
  /** Send a job and return assistant-visible text. */
  ask(message: string, opts?: { skills?: string[] }): Promise<YardAskResult>;
  /** Release local resources (MCP, etc.). No-op for Eve. */
  close(): Promise<void>;
}

export interface YardAskResult {
  kind: YardRuntimeKind;
  text: string;
  sessionId?: string;
  threadId?: string;
  eve?: EveAskResult;
}

/**
 * Open the preferred YardDog runtime for CLI / TUI.
 *
 * Prefer Eve when configured and healthy; otherwise use the local adapter.
 */
export async function openYard(
  options: OpenYardOptions = {},
): Promise<YardRuntime> {
  const log = options.log ?? (() => {});
  const target = resolveClientTarget(options);
  return openFromTarget(target, options, log);
}

async function openFromTarget(
  target: ResolvedClientTarget,
  options: OpenYardOptions,
  log: (line: string) => void,
): Promise<YardRuntime> {
  if (target.mode === "eve" && target.eveUrl) {
    const eve = new EveClient({
      host: target.eveUrl,
      bearer:
        options.eve?.bearer ??
        process.env.YARDDOG_EVE_TOKEN ??
        process.env.EVE_TOKEN,
      headers: options.eve?.headers,
      fetch: options.eve?.fetch,
    });

    const allowFallback =
      options.fallbackToLocal ?? target.allowLocalFallback;

    const ready = await eve.isReady();
    if (!ready) {
      if (!allowFallback) {
        throw new Error(
          `Eve host not ready at ${target.eveUrl} (GET /eve/v1/health failed)`,
        );
      }
      log(
        `eve unreachable at ${target.eveUrl} — falling back to local adapter`,
      );
      return openLocal(options, {
        reason: `fallback: Eve health failed at ${target.eveUrl}`,
        fellBack: true,
        eveUrl: target.eveUrl,
      });
    }

    log(`client → Eve @ ${target.eveUrl}`);
    return openEve(eve, target);
  }

  return openLocal(options, {
    reason: target.reason,
    fellBack: false,
  });
}

function openEve(eve: EveClient, target: ResolvedClientTarget): YardRuntime {
  const state: { sessionId?: string } = {};
  return {
    kind: "eve",
    reason: target.reason,
    eveUrl: target.eveUrl,
    fellBack: false,
    eve,
    get eveSessionId() {
      return state.sessionId;
    },
    async ask(message: string): Promise<YardAskResult> {
      const result = state.sessionId
        ? await eve.send(state.sessionId, message)
        : await eve.ask(message);
      state.sessionId = result.sessionId;
      return {
        kind: "eve",
        text: result.text,
        sessionId: result.sessionId,
        eve: result,
      };
    },
    async close() {
      /* Eve sessions are durable server-side; nothing to tear down locally. */
    },
  };
}

async function openLocal(
  options: OpenYardOptions,
  meta: { reason: string; fellBack: boolean; eveUrl?: string },
): Promise<YardRuntime> {
  const dog = await YardDog.create({
    ...(options.local ?? {}),
    workdir: options.workdir ?? options.local?.workdir,
  });
  return {
    kind: "local",
    reason: meta.reason,
    eveUrl: meta.eveUrl,
    fellBack: meta.fellBack,
    dog,
    async ask(message, opts): Promise<YardAskResult> {
      const thread = dog.activeThread();
      await dog.send(thread.id, message, { skills: opts?.skills });
      const updated = dog.getThread(thread.id) ?? thread;
      const lastAgent = [...updated.messages]
        .reverse()
        .find((m) => m.from !== "user");
      return {
        kind: "local",
        text: lastAgent?.text ?? "",
        threadId: thread.id,
      };
    },
    async close() {
      await dog.mcp.shutdown();
    },
  };
}

/** Describe the resolved target without opening connections (for `status`). */
export function describeYardTarget(
  options: YardClientModeOptions = {},
): ResolvedClientTarget {
  return resolveClientTarget(options);
}
