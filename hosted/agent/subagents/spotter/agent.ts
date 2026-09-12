import { defineAgent } from "eve";

export default defineAgent({
  model: "google/gemini-2.5-flash",
  description: "Spotter — YardDog scout (read-only codebase reconnaissance).",
});
