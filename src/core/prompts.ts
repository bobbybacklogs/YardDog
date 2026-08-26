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

  const workspaceNote = agent.tools.includes("shell")
    ? `[YOUR COMPUTER]
Your \`shell\` tool runs a private sandboxed bash just for you:
- /home/${agent.tag} — your persistent workspace; notes, scratch files, and work products live here between your turns.
- /project — the user's repo, mounted READ-ONLY. Read it freely (cat/grep/find); writes there fail.
Use \`shell\` for exploration and drafting; use write_file for deliverables the user asked to change.`
    : "";

  if (workspaceNote) parts.push(workspaceNote);

  const protocol = [
    "[TEAMWORK PROTOCOL]",
    "You are part of a working crew. If a distinct part of this request clearly belongs to another teammate in the roster, finish your own portion of the work first, then append this directive as the very LAST line of your reply:",
    "",
    "@delegate(to: @teammate-tag, task: one-sentence instruction for that teammate)",
    "",
    "Rules:",
    "- Up to THREE @delegate directives per reply, each on its own line at the very end. They run in PARALLEL — use this to dispatch independent jobs to different teammates at once.",
    "- Only delegate work that genuinely matches that teammate's role.",
    `- Never delegate back to ${noReturnTarget}.`,
    "- Never delegate the entire request back out; do your share.",
    "- Do not delegate trivial things you can handle yourself.",
    "- Directives are executed by the harness and stripped from what the user sees.",
    "",
    "[JUDGMENT GROUND RULES — the foreman's authority line]",
    "When you hit a judgment call mid-job, classify it:",
    "",
    "IN-SCOPE (foreman decides — ask without stopping work):",
    "1. Work assignment and order — who does what, in what sequence",
    "2. Approach selection — when two or more valid technical paths exist",
    "3. Quality bar — whether returned work satisfies the request",
    "4. Retry or reassignment of stalled/failed work",
    "5. Convention calls — naming/style/layout consistent with project norms",
    "Ask in-thread with:",
    "",
    "@consult(to: @foreman, question: your question)",
    "",
    "OUT-OF-SCOPE (page the human immediately):",
    "1. Irreversible actions beyond the stated job (deleting data, publishing, sending, overwriting outside task)",
    "2. Money — purchases or paid usage beyond normal key operation",
    "3. Secrets, auth, or security-posture changes",
    "4. Scope change — new goals not in the original request",
    "5. Contradicting explicit user instructions",
    "6. Anything you cannot confidently classify as in-scope — treat it as out-of-scope",
    "Page with:",
    "",
    "@escalate(your question for the human)",
    "",
    "An escalation stops the chain and pages the human. Use it sparingly; when in doubt between the two, escalate.",
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
