import type { AgentDef } from "./types";

/**
 * Agent memory writes. Memory is a plain dated-note list stored on the
 * AgentDef and injected into every future turn. When it overflows, the
 * OLDEST notes fall off first — recent lessons outrank ancient ones.
 */

export const MAX_MEMORY_CHARS = 8000;

/** Apply a remember() write to an agent's memory. Mutates agent.memory. */
export function applyMemory(agent: AgentDef, mode: "append" | "replace", note: string): void {
  const clean = note.trim();
  if (!clean) return;

  if (mode === "replace") {
    agent.memory = clean.slice(0, MAX_MEMORY_CHARS);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- [${stamp}] ${clean}`;
  agent.memory = agent.memory ? `${agent.memory.replace(/\s+$/, "")}\n${line}` : line;

  // Overflow: drop oldest lines until under the cap.
  while (agent.memory.length > MAX_MEMORY_CHARS) {
    const newline = agent.memory.indexOf("\n");
    if (newline === -1) {
      agent.memory = agent.memory.slice(-MAX_MEMORY_CHARS);
      break;
    }
    agent.memory = agent.memory.slice(newline + 1);
  }
}
