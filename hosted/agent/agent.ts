import { defineAgent } from "eve";

/**
 * YardDog hosted agent — preferred production runtime.
 * Model traffic goes through Vercel AI Gateway (Eve default), not ModelHitch.
 */
export default defineAgent({
  model: "google/gemini-2.5-flash",
  build: {
    // CursorPlane pulls @cursor/sdk (and native helpers like @mongodb-js/zstd /
    // bun:sqlite). Keep them external so Eve/Nitro traces them into
    // server/node_modules instead of bundling native binaries.
    externalDependencies: [
      "@cursor/sdk",
      "@mongodb-js/zstd",
      "ai",
      "just-bash",
    ],
  },
});
