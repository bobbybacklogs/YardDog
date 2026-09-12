/**
 * YardDog Cursor @delegate plane — job + roster types.
 */

export type CursorJobStatus =
  | "queued"
  | "running"
  | "finished"
  | "error"
  | "cancelled";

export interface CursorRepoRef {
  url: string;
  startingRef?: string;
}

export interface CursorJob {
  /** Cursor cloud agent id (`bc-…`). */
  id: string;
  /** Active / last run id when known. */
  runId?: string;
  /** Session roster tag (e.g. `cursorbay` or `cursor-a1b2`). */
  tag: string;
  task: string;
  status: CursorJobStatus;
  text?: string;
  error?: string;
  prUrl?: string;
  branch?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CursorDispatchRequest {
  task: string;
  /** Roster tag for this job. Default: `cursorbay`. */
  tag?: string;
  repos?: CursorRepoRef[];
  autoCreatePR?: boolean;
  modelId?: string;
  name?: string;
  /** When false, return after create+send without waiting for finish. Default true. */
  wait?: boolean;
}

export interface CursorPlaneEvent {
  job: CursorJob;
  kind: "delta" | "tool" | "status" | "finish" | "error";
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

/** Canonical always-on floor handle for Cursor Cloud workers. */
export const CURSOR_BAY_TAG = "cursorbay";

export function isCursorDelegateTag(tag: string): boolean {
  const t = tag.toLowerCase().replace(/^@/, "");
  if (t === CURSOR_BAY_TAG || t === "cursor") return true;
  return t.startsWith("cursor-") || t.startsWith("cursor_");
}
