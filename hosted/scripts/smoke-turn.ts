/**
 * Smoke one YardDog AI Gateway turn outside the Eve TUI (Node).
 *
 * Requires AI_GATEWAY_API_KEY (Eve/Vercel) or a linked OIDC token.
 * Usage: npm run smoke-turn -- "Say hello from YardDog Phase 1"
 */

import { AiSdkAdapter } from "../agent/lib/yarddog-model.ts";

const prompt =
  process.argv.slice(2).join(" ").trim() || "Reply with exactly: yarddog-phase1-ok";

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.error(
      "Missing AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN). Create a key in the Vercel AI Gateway dashboard.",
    );
    process.exit(2);
  }

  const adapter = new AiSdkAdapter();
  process.stdout.write("lane… ");

  for await (const chunk of adapter.streamTurn({
    messages: [
      {
        role: "system",
        content: "You are YardDog Phase 1 smoke. Be terse. No ModelHitch.",
      },
      { role: "user", content: prompt },
    ],
    lane: "fast",
    taskComplexity: "quick_response",
  })) {
    if (chunk.type === "lane") {
      console.log(`${chunk.lane} · ${chunk.modelId}`);
      console.log(`reason: ${chunk.reason}`);
      process.stdout.write("assistant: ");
    } else if (chunk.type === "text-delta") {
      process.stdout.write(chunk.text);
    } else if (chunk.type === "failover") {
      console.log(`\n[failover] ${chunk.fromModelId} → ${chunk.toModelId} (${chunk.cause})`);
      process.stdout.write("assistant: ");
    } else if (chunk.type === "finish") {
      console.log("\n---");
      console.log(
        JSON.stringify(
          {
            ok: true,
            modelId: chunk.modelId,
            lane: chunk.lane,
            usage: chunk.usage,
            modelHitch: false,
          },
          null,
          2,
        ),
      );
    } else if (chunk.type === "error") {
      console.error("\nERROR:", chunk.error);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
