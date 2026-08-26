import type { AgentDef, ThreadMessage } from "./types";

/**
 * System prompt assembly. Every agent sees:
 *   1. Its own persona (role + system prompt)
 *   2. Its durable memory notes
 *   3. The team roster — so it knows who it can hand work to
 *   4. The teamwork protocol — the @delegate / @escalate wire rules
 */

export function renderRoster(agents: AgentDef[], selfTag: string): string {
  return agents
    .map((a) => `- @${a.tag} — ${a.role}${a.tag === selfTag ? " (you)" : ""}`)
    .join("\n");
}

const MAX_MEMORY_CHARS = 4000;

export function buildSystemPrompt(agent: AgentDef, crew: AgentDef[], delegator?: string): string {
  const others = crew.filter((a) => a.tag !== agent.tag);
  const noReturnTarget =
    delegator && delegator !== agent.tag ? `@${delegator}` : "the teammate who handed you work";

  const parts: string[] = [];

  parts.push(
    [
      `You are @${agent.tag} (${agent.name}), ${agent.role}.`,
      agent.description ? agent.description : "",
      "",
      agent.systemPrompt.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (agent.memory.trim()) {
    parts.push(
      `[PERSISTENT MEMORY — your own durable notes, kept across sessions]\n${agent.memory.slice(0, MAX_MEMORY_CHARS)}`,
    );
  }

  parts.push(`[TEAM ROSTER]\n${renderRoster(crew, agent.tag)}`);

  const protocol = [
    "[TEAMWORK PROTOCOL]",
    "You are part of a working crew. If a distinct part of this request clearly belongs to another teammate in the roster, finish your own portion of the work first, then append this directive as the very LAST line of your reply:",
    "",
    "@delegate(to: @teammate-tag, task: one-sentence instruction for that teammate)",
    "",
    "Rules:",
    "- At most ONE @delegate per reply. Only delegate work that genuinely matches that teammate's role.",
    `- Never delegate back to ${noReturnTarget}.`,
    "- Never delegate the entire request back out; do your share.",
    "- Do not delegate trivial things you can handle yourself.",
    "- Directives are executed by the harness and stripped from what the user sees.",
    "",
    "If you hit something that genuinely needs a human judgment call (approvals, ambiguity with real cost, missing access), append instead:",
    "",
    "@escalate(your question for the human)",
    "",
    "An escalation stops the chain and pages the human. Use it sparingly; when in doubt, state your assumption and keep moving.",
  ].join("\n");

  parts.push(protocol);

  return parts.join("\n\n");
}

/**
 * Map thread history into ModelHitch messages. Each message is labeled with
 * its author so agents can tell crew members apart in the shared transcript.
 */
export function historyToMessages(
  history: ThreadMessage[],
  selfTag: string,
  windowSize = 24,
): { role: "user" | "assistant"; content: string }[] {
  return history.slice(-windowSize).map((m) => {
    if (m.from === selfTag) {
      return { role: "assistant" as const, content: m.text };
    }
    const label = m.from === "user" ? "user" : `@${m.from}`;
    return { role: "user" as const, content: `[from ${label}] ${m.text}` };
  });
}
