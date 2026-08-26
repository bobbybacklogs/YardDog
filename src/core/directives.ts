import type { Escalation, Handoff } from "./types";

/**
 * The A2A wire protocol, Grok-Bot style: agents route work by appending
 * plain-text directives to the very end of a reply. The harness parses them,
 * strips them from what the user sees, and executes them mechanically.
 *
 *   @delegate(to: @tag, task: one-sentence instruction)
 *   @escalate(question for the human)
 */

const DELEGATE_RE =
  /@delegate\(\s*to:\s*@?([A-Za-z0-9_-]+)\s*,\s*task:\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;
const ESCALATE_RE = /@escalate\(\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;

export interface ParsedReply {
  /** Reply text with directives removed and trailing whitespace trimmed. */
  clean: string;
  handoff?: Handoff;
  escalation?: Escalation;
}

export function parseReply(text: string, fromTag: string): ParsedReply {
  let clean = text;
  let handoff: Handoff | undefined;
  let escalation: Escalation | undefined;

  const delegateMatch = DELEGATE_RE.exec(clean);
  if (delegateMatch) {
    const to = delegateMatch[1]!.toLowerCase();
    const task = delegateMatch[2]!.trim();
    if (to && task) {
      handoff = { from: fromTag, to, task };
      clean = clean.replace(DELEGATE_RE, "");
    }
  }

  // Escalation wins over delegation: a judgment call goes to the human.
  const escalateMatch = ESCALATE_RE.exec(clean);
  if (escalateMatch) {
    const question = escalateMatch[1]!.trim();
    if (question) {
      escalation = { from: fromTag, question };
      clean = clean.replace(ESCALATE_RE, "");
      handoff = undefined;
    }
  }

  return { clean: clean.replace(/\s+$/, ""), handoff, escalation };
}
