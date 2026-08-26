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

export function startServe(dog: YardDog, opts: ServeOptions = {}): void {
  const port = opts.port ?? Number(process.env.YARDDOG_PORT ?? 4343);
  const eventControllers = new Set<ReadableStreamDefaultController>();

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;

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

  console.log(`yarddog serve listening on http://127.0.0.1:${port}`);
  console.log(`  POST /jobs {"job": "..."} · GET /events (SSE) · GET /agents · GET /threads`);
}

const encoder = new TextEncoder();

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
