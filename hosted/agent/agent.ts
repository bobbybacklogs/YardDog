import { defineAgent } from "eve";

/**
 * YardDog hosted agent — preferred production runtime.
 * Model traffic goes through Vercel AI Gateway (Eve default), not ModelHitch.
 */
export default defineAgent({
  model: "google/gemini-2.5-flash",
});
