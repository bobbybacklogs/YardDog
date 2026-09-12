/**
 * Resolve how the Bun CLI / OpenTUI should talk to the yard.
 *
 *   local  — in-process YardDog (AiSdkAdapter + just-bash computers)
 *   eve    — HTTP client of an Eve-hosted YardDog (`/eve/v1/*`)
 *   auto   — prefer Eve when a URL is set and /health is ready; else local
 */

export type YardClientMode = "local" | "eve" | "auto";

export type ResolvedYardClientMode = "local" | "eve";

export interface YardClientModeOptions {
  /** Explicit mode (CLI flag / env). Default: env YARDDOG_MODE or "auto". */
  mode?: YardClientMode;
  /** Eve base URL (no trailing slash). Env: YARDDOG_EVE_URL. */
  eveUrl?: string;
  /** Force local even if Eve URL is set. */
  forceLocal?: boolean;
  /** Force Eve (requires a URL). */
  forceEve?: boolean;
}

export interface ResolvedClientTarget {
  mode: ResolvedYardClientMode;
  /** Why this mode was chosen (for `yarddog status` / banners). */
  reason: string;
  /** Eve host when mode === "eve". */
  eveUrl?: string;
  /** True when we intended Eve but will retry as local on failure. */
  allowLocalFallback: boolean;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readEveUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.YARDDOG_EVE_URL?.trim() || env.EVE_URL?.trim();
  return raw ? normalizeUrl(raw) : undefined;
}

export function readModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): YardClientMode {
  const raw = (env.YARDDOG_MODE ?? "auto").trim().toLowerCase();
  if (raw === "local" || raw === "eve" || raw === "auto") return raw;
  return "auto";
}

/**
 * Decide local vs Eve without doing network I/O.
 * `auto` with a URL resolves to `eve` + fallback allowed; without a URL → local.
 */
export function resolveClientTarget(
  options: YardClientModeOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedClientTarget {
  if (options.forceLocal) {
    return {
      mode: "local",
      reason: "forced local (--local / YARDDOG_MODE=local)",
      allowLocalFallback: false,
    };
  }

  const eveUrl = options.eveUrl
    ? normalizeUrl(options.eveUrl)
    : readEveUrlFromEnv(env);

  if (options.forceEve) {
    if (!eveUrl) {
      throw new Error(
        "Eve client mode requires --eve <url> or YARDDOG_EVE_URL",
      );
    }
    return {
      mode: "eve",
      reason: "forced Eve (--eve / YARDDOG_MODE=eve)",
      eveUrl,
      allowLocalFallback: false,
    };
  }

  const mode = options.mode ?? readModeFromEnv(env);

  switch (mode) {
    case "local":
      return {
        mode: "local",
        reason: "YARDDOG_MODE=local",
        allowLocalFallback: false,
      };
    case "eve":
      if (!eveUrl) {
        throw new Error(
          "YARDDOG_MODE=eve requires YARDDOG_EVE_URL (or --eve <url>)",
        );
      }
      return {
        mode: "eve",
        reason: "YARDDOG_MODE=eve",
        eveUrl,
        allowLocalFallback: false,
      };
    case "auto":
      if (eveUrl) {
        return {
          mode: "eve",
          reason: "auto: YARDDOG_EVE_URL set — prefer Eve, fall back to local",
          eveUrl,
          allowLocalFallback: true,
        };
      }
      return {
        mode: "local",
        reason: "auto: no YARDDOG_EVE_URL — local adapter",
        allowLocalFallback: false,
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
