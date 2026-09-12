/**
 * Eve tool: dispatch a Cursor Cloud agent via YardDog's CursorPlane.
 * Same path as `@delegate(to: @cursorbay, task: …)` / `dispatch_cursor_job`.
 */

import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { CursorPlane } from "../../../src/cursor/index.ts";

export default defineTool({
  description:
    "Dispatch a Cursor Cloud coding agent through YardDog's @delegate plane (@cursorbay). Use for multi-file / PR / long jobs. Requires CURSOR_API_KEY. Prefer yarddog_send with @delegate(to: @cursorbay) for full crew context.",
  inputSchema: z.object({
    task: z.string().min(1).describe("Job for the Cursor Cloud agent"),
    repo: z.string().optional().describe("GitHub repo URL (optional)"),
    branch: z.string().optional().describe("Starting git ref (optional)"),
    autoCreatePR: z
      .boolean()
      .optional()
      .describe("Open a PR when done (default true)"),
    wait: z
      .boolean()
      .optional()
      .describe("Wait for completion (default true)"),
  }),
  approval: never(),
  async execute({ task, repo, branch, autoCreatePR, wait }) {
    const plane = new CursorPlane();
    if (!plane.ready) {
      return {
        ok: false,
        error: "CURSOR_API_KEY is not set",
        via: "cursor-sdk",
      };
    }
    try {
      const job = await plane.dispatch({
        task,
        wait: wait !== false,
        autoCreatePR: autoCreatePR !== false,
        repos: repo ? [{ url: repo, startingRef: branch }] : undefined,
      });
      return {
        ok: true,
        id: job.id,
        tag: job.tag,
        status: job.status,
        text: job.text,
        prUrl: job.prUrl,
        branch: job.branch,
        error: job.error,
        via: "cursor-sdk",
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        via: "cursor-sdk",
      };
    }
  },
});
