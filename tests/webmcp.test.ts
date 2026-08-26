import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { YardDog } from "../src/core/harness";
import { startServe } from "../src/serve";

let server: ReturnType<typeof Bun.serve>;
const base = () => `http://127.0.0.1:${server.port}`;

beforeAll(async () => {
  const workdir = path.join(import.meta.dir, ".tmp-serve");
  await mkdir(path.join(workdir, ".yarddog"), { recursive: true });
  await writeFile(
    path.join(workdir, ".yarddog", "config.json"),
    JSON.stringify({ provider: "mock", model: "mock-model", maxDepth: 3, autoApproveTools: true }),
  );
  const dog = await YardDog.create({ workdir });
  server = startServe(dog, { port: 0 }); // random free port
});

afterAll(() => {
  server.stop(true);
});

describe("webmcp dashboard", () => {
  test("GET / serves the dashboard with site-tool registrations", async () => {
    const res = await fetch(`${base()}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("document.modelContext.registerTool");
    // every registered tool is present
    for (const name of ["get_yard_status", "list_threads", "get_thread", "post_job", "hire_temp"]) {
      expect(html).toContain(`"${name}"`);
    }
    // reads declare readOnlyHint
    expect(html).toContain("readOnlyHint");
  });

  test("POST /hire/:name returns a receipt", async () => {
    const res = await fetch(`${base()}/hire/${encodeURIComponent("Debug & Repair Generalist")}`, {
      method: "POST",
    });
    const body = (await res.json()) as { hired?: string; error?: string };
    if (res.status === 200) {
      expect(body.hired).toBe("debug-repair-generalist");
    } else {
      // machine without the temp pool — endpoint still contract-clean
      expect(body.error).toBeTruthy();
    }
  });

  test("post_job ?wait=1 resolves after the crew settles", async () => {
    const res = await fetch(`${base()}/jobs?wait=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job: "hello from webmcp test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threadId: string; status: string };
    expect(body.status).toBe("complete");
    const thread = await (await fetch(`${base()}/threads/${body.threadId}`)).json();
    expect(thread.messages.some((m: { text: string }) => m.text.includes("hello from webmcp test"))).toBe(true);
  }, 30_000);
});
