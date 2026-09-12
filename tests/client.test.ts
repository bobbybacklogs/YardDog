import { describe, expect, test } from "bun:test";
import {
  readEveUrlFromEnv,
  readModeFromEnv,
  resolveClientTarget,
} from "../src/client/mode";
import { EveClient, extractAssistantText } from "../src/client/eve";
import { describeYardTarget, openYard } from "../src/client/open";

describe("client mode resolution", () => {
  test("auto without URL → local", () => {
    const target = resolveClientTarget({}, {});
    expect(target.mode).toBe("local");
    expect(target.allowLocalFallback).toBe(false);
  });

  test("auto with YARDDOG_EVE_URL → eve + fallback", () => {
    const target = resolveClientTarget(
      {},
      { YARDDOG_EVE_URL: "http://127.0.0.1:2000/" },
    );
    expect(target.mode).toBe("eve");
    expect(target.eveUrl).toBe("http://127.0.0.1:2000");
    expect(target.allowLocalFallback).toBe(true);
  });

  test("forceLocal wins over URL", () => {
    const target = resolveClientTarget(
      { forceLocal: true, eveUrl: "http://eve.test" },
      { YARDDOG_EVE_URL: "http://env.test" },
    );
    expect(target.mode).toBe("local");
    expect(target.allowLocalFallback).toBe(false);
  });

  test("forceEve requires a URL", () => {
    expect(() => resolveClientTarget({ forceEve: true }, {})).toThrow(
      /YARDDOG_EVE_URL/,
    );
  });

  test("YARDDOG_MODE=eve requires URL", () => {
    expect(() =>
      resolveClientTarget({}, { YARDDOG_MODE: "eve" }),
    ).toThrow(/YARDDOG_EVE_URL/);
  });

  test("read helpers", () => {
    expect(readModeFromEnv({ YARDDOG_MODE: "local" })).toBe("local");
    expect(readModeFromEnv({ YARDDOG_MODE: "nope" })).toBe("auto");
    expect(readEveUrlFromEnv({ EVE_URL: "http://x/" })).toBe("http://x");
  });

  test("describeYardTarget mirrors resolveClientTarget", () => {
    const a = describeYardTarget({ eveUrl: "http://eve.example" });
    const b = resolveClientTarget({ eveUrl: "http://eve.example" });
    expect(a).toEqual(b);
  });
});

describe("EveClient", () => {
  test("health + ask against mock host", async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/eve/v1/health")) {
        return new Response(JSON.stringify({ ok: true, status: "ready" }), {
          status: 200,
        });
      }
      if (url.endsWith("/eve/v1/session") && init?.method === "POST") {
        const id = "sess_test";
        return new Response(JSON.stringify({ sessionId: id }), {
          status: 202,
          headers: { "x-eve-session-id": id },
        });
      }
      if (url.includes("/eve/v1/session/sess_test/stream")) {
        const body =
          JSON.stringify({ type: "message.delta", delta: "hello " }) +
          "\n" +
          JSON.stringify({ type: "message.delta", delta: "yard" }) +
          "\n" +
          JSON.stringify({ type: "session.waiting" }) +
          "\n";
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      return new Response("missing", { status: 404 });
    };

    const eve = new EveClient({
      host: "http://eve.test",
      fetch: fetchMock,
    });
    expect(await eve.isReady()).toBe(true);
    const result = await eve.ask("hi");
    expect(result.sessionId).toBe("sess_test");
    expect(result.text).toBe("hello yard");
  });

  test("isReady returns false on network failure", async () => {
    const eve = new EveClient({
      host: "http://eve.test",
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(await eve.isReady()).toBe(false);
  });

  test("extractAssistantText fallbacks", () => {
    expect(
      extractAssistantText([
        { type: "message", text: "done" },
        { type: "session.waiting" },
      ]),
    ).toBe("done");
  });
});

describe("openYard fallback", () => {
  test("auto Eve unhealthy → local adapter", async () => {
    const runtime = await openYard({
      eveUrl: "http://eve.down",
      fallbackToLocal: true,
      eve: {
        fetch: async () => new Response("nope", { status: 503 }),
      },
      log: () => {},
    });
    expect(runtime.kind).toBe("local");
    expect(runtime.fellBack).toBe(true);
    await runtime.close();
  });
});
