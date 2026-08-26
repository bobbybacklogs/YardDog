import type { YardDog } from "./core/harness";
import type { YardDogEvent } from "./core/types";

/**
 * yarddog serve — local HTTP surface for the yard.
 *
 *   GET  /healthz                 liveness
 *   GET  /agents                  roster + presence
 *   GET  /threads                 thread list
 *   GET  /threads/:id             full thread JSON
 *   POST /jobs                    post a job { job, threadId?, skills?, hires? }
 *                                 → 202 { threadId } (fire-and-forget)
 *                                 → ?wait=1 resolves after orchestration settles
 *   GET  /events                  Server-Sent Events stream of harness events
 *
 * Binds 127.0.0.1 only — this is a localhost tool, not a network service.
 */

export interface ServeOptions {
  port?: number;
}

interface JobBody {
  job?: string;
  threadId?: string;
  skills?: string[];
  hires?: string[];
}

export function startServe(dog: YardDog, opts: ServeOptions = {}): ReturnType<typeof Bun.serve> {
  const port = opts.port ?? Number(process.env.YARDDOG_PORT ?? 4343);
  const eventControllers = new Set<ReadableStreamDefaultController>();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/") {
        return new Response(dashboardHtml(), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && pathname === "/healthz") {
        return json({ ok: true, working: dog.working, pending: dog.pending });
      }

      if (req.method === "GET" && pathname === "/agents") {
        return json({
          agents: dog.agents.map((a) => ({
            tag: a.tag,
            name: a.name,
            role: a.role,
            temp: a.temp?.vendor ?? null,
            presence: dog.getPresence(a.tag),
            lane: `${a.provider}/${a.model}`,
          })),
        });
      }

      if (req.method === "GET" && pathname === "/threads") {
        return json({
          threads: dog.listThreads().map((t) => ({
            id: t.id,
            title: t.title,
            messages: t.messages.length,
            updatedAt: t.updatedAt,
          })),
        });
      }

      const threadMatch = pathname.match(/^\/threads\/([A-Za-z0-9-]+)$/);
      if (req.method === "GET" && threadMatch) {
        const thread = dog.getThread(threadMatch[1]!);
        return thread ? json(thread) : notFound(`no thread ${threadMatch[1]}`);
      }

      const hireMatch = pathname.match(/^\/hire\/([A-Za-z0-9._-]+)$/);
      if (req.method === "POST" && hireMatch) {
        try {
          const { def } = await dog.hireTemp(decodeURIComponent(hireMatch[1]!));
          return json({ hired: def.tag, notes: def.temp?.vendor ?? null });
        } catch (err) {
          return badRequest((err as Error).message);
        }
      }

      if (req.method === "POST" && pathname === "/jobs") {
        let body: JobBody;
        try {
          body = (await req.json()) as JobBody;
        } catch {
          return badRequest("body must be JSON");
        }
        if (!body.job || typeof body.job !== "string" || !body.job.trim()) {
          return badRequest('missing "job" string');
        }
        for (const name of body.hires ?? []) {
          try {
            await dog.hireTemp(name);
          } catch (err) {
            return badRequest(`hire failed: ${(err as Error).message}`);
          }
        }
        const thread = body.threadId
          ? dog.getThread(body.threadId) ?? dog.createThread(body.threadId)
          : dog.activeThread();

        const running = dog.send(thread.id, body.job.trim(), {
          skills: Array.isArray(body.skills) ? body.skills : [],
        });

        if (url.searchParams.get("wait") === "1") {
          try {
            await running;
          } catch (err) {
            return badRequest((err as Error).message);
          }
          return json({ threadId: thread.id, status: "complete", pending: dog.pending });
        }
        return new Response(JSON.stringify({ threadId: thread.id, status: "queued", pending: dog.pending }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }

      if (req.method === "GET" && pathname === "/events") {
        let thisController: ReadableStreamDefaultController | undefined;
        const stream = new ReadableStream({
          start(controller) {
            thisController = controller;
            eventControllers.add(controller);
            controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
          },
          cancel() {
            if (thisController) eventControllers.delete(thisController);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      return notFound("unknown route");
    },
  });

  // Fan harness events out to every SSE subscriber.
  dog.on("event", (event: YardDogEvent) => {
    const frame = encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    for (const controller of [...eventControllers]) {
      try {
        controller.enqueue(frame);
      } catch {
        eventControllers.delete(controller); // subscriber went away
      }
    }
  });

  console.log(`yarddog serve listening on http://127.0.0.1:${server.port}`);
  console.log(`  dashboard: open that URL in a browser — WebMCP tools included`);
  console.log(`  POST /jobs {"job": "..."} · GET /events (SSE) · GET /agents · GET /threads`);
  return server;
}

const encoder = new TextEncoder();

/**
 * The yard's browser face. Zero dependencies: a human-readable status page
 * that ALSO registers WebMCP site tools on document.modelContext, so
 * ChatGPT Work / Codex (built-in browser) can discover and drive the yard.
 * Tools call the same localhost endpoints everything else uses — approval
 * gates and confinement still apply inside the harness.
 */
function dashboardHtml(): string {
  return [
"<!doctype html>",
'<html><head><meta charset="utf-8"><title>YardDog</title>',
"<style>",
"body{background:#0d0d0d;color:#e8e8e8;font-family:ui-monospace,Consolas,monospace;margin:2rem;}",
"h1{color:#FFD75E;font-size:1.4rem;} h2{color:#5EB7FF;font-size:1rem;margin-top:1.5rem;}",
".row{margin:.15rem 0;} .dim{color:#777;} .warn{color:#FFD75E;} .err{color:#FF5E5E;} .ok{color:#5EFF8B;}",
"input{background:#161616;color:#e8e8e8;border:1px solid #333;padding:.4rem;width:60%;font-family:inherit;}",
"button{background:#FFD75E;border:none;color:#000;padding:.45rem .9rem;font-family:inherit;font-weight:bold;cursor:pointer;}",
"#log{border:1px solid #333;padding:.6rem;height:14rem;overflow:auto;background:#101010;font-size:.85rem;white-space:pre-wrap;}",
"</style></head><body>",
"<h1>🐕 YARDDOG</h1>",
'<div class="dim">local yard floor — WebMCP site tools registered for compatible agents</div>',
'<h2>status</h2><div id="status" class="dim">loading…</div>',
"<form id=\"jobform\"><input id=\"job\" placeholder=\"post a job to the crew…\" autocomplete=\"off\"> <button>send</button></form>",
'<h2>crew</h2><div id="agents"></div>',
'<h2>threads</h2><div id="threads"></div>',
'<h2>events</h2><pre id="log"></pre>',
"<script type=\"module\">",
'const api = (p) => fetch(p).then((r) => r.json());',
'const log = (msg, cls) => { const el = document.getElementById("log"); el.textContent += msg + "\\n"; el.scrollTop = el.scrollHeight; };',
"",
"// ---- WebMCP site tools (ChatGPT Work / Codex discover these) ----",
"const tools = [",
"  {",
'    name: "get_yard_status",',
'    description: "YardDog multi-agent harness: current working state and queue depth.",',
'    inputSchema: { type: "object", properties: {}, additionalProperties: false },',
"    annotations: { readOnlyHint: true },",
'    execute: async () => ({ health: await api("/healthz"), agents: await api("/agents") }),',
"  },",
"  {",
'    name: "list_threads",',
'    description: "List YardDog conversation threads with message counts.",',
'    inputSchema: { type: "object", properties: {}, additionalProperties: false },',
"    annotations: { readOnlyHint: true },",
'    execute: async () => api("/threads"),',
"  },",
"  {",
'    name: "get_thread",',
'    description: "Read the full transcript of one YardDog thread.",',
'    inputSchema: { type: "object", properties: { threadId: { type: "string", description: "thread id from list_threads" } }, required: ["threadId"], additionalProperties: false },',
"    annotations: { readOnlyHint: true },",
'    execute: async ({ threadId }) => api("/threads/" + encodeURIComponent(threadId)),',
"  },",
"  {",
'    name: "post_job",',
'    description: "Post a job to the YardDog crew. @mention an agent tag to route directly; otherwise the foreman dispatches. Returns immediately with the thread id.",',
'    inputSchema: { type: "object", properties: { job: { type: "string", description: "the work request in plain language" }, threadId: { type: "string", description: "optional existing thread id" }, skills: { type: "array", items: { type: "string" }, description: "optional skill names to attach" } }, required: ["job"], additionalProperties: false },',
"    annotations: { readOnlyHint: false },",
'    execute: async ({ job, threadId, skills }) => {',
'      const res = await fetch("/jobs?wait=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job, threadId, skills }) });',
"      return res.json();",
"    },",
"  },",
"  {",
'    name: "hire_temp",',
'    description: "Hire a temp worker into the YardDog roster from the machine\'s local agent directories.",',
'    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },',
"    annotations: { readOnlyHint: false },",
    '    execute: async ({ name }) => fetch("/hire/" + encodeURIComponent(name), { method: "POST" }).then((r) => r.json()),',
"  },",
"];",
"",
'if (typeof document.modelContext !== "undefined" && typeof document.modelContext.registerTool === "function") {',
"  for (const t of tools) {",
"    try { await document.modelContext.registerTool(t); log(\"site tool registered: \" + t.name, \"ok\"); }",
'    catch (e) { log("register failed: " + t.name + " — " + e.message, "err"); }',
"  }",
"} else {",
'  log("WebMCP not detected in this browser — human mode only.", "warn");',
"}",
"",
"// ---- Human UI ----",
'async function refresh() {',
'  try {',
'    const h = await api("/healthz");',
'    document.getElementById("status").textContent =',
'      (h.working ? "working" : "idle") + " · jobs pending: " + h.pending;',
'    const agents = (await api("/agents")).agents;',
'    document.getElementById("agents").innerHTML = agents.map(a =>',
'      "<div class=row>" + (a.presence === "idle" ? "·" : "▲") + " @" + a.tag + " <span class=dim>" + a.presence + (a.temp ? " · temp:" + a.temp : "") + "</span></div>"',
'    ).join("");',
'    const th = (await api("/threads")).threads.slice(0, 8);',
'    document.getElementById("threads").innerHTML = th.map(t =>',
'      "<div class=row>" + t.id + " <span class=dim>" + t.title + " (" + t.messages + " msgs)</span></div>"',
'    ).join("") || \'<div class=dim>(none)</div>\';',
'  } catch (e) { document.getElementById("status").textContent = "offline"; }',
'}',
'refresh(); setInterval(refresh, 3000);',
"",
'document.getElementById("jobform").addEventListener("submit", async (e) => {',
'  e.preventDefault();',
'  const input = document.getElementById("job");',
'  if (!input.value.trim()) return;',
'  await fetch("/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: input.value.trim() }) });',
'  input.value = "";',
'  log("job posted.", "warn");',
'});',
"",
'const es = new EventSource("/events");',
'es.onmessage = (m) => { try { const ev = JSON.parse(m.data); log(ev.type + " " + JSON.stringify(ev).slice(0, 220)); } catch {} };',
'es.addEventListener("turn:end", (m) => { try { const ev = JSON.parse(m.data); log("→ @" + ev.message.from + ": " + String(ev.message.text).slice(0, 160), "ok"); refresh(); } catch {} });',
"</script></body></html>",
].join("\n");
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status: 400 });
}
function notFound(message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status: 404 });
}
