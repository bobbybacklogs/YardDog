import type { AgentDef, Consult, Escalation, Handoff } from "./types";

/**
 * The A2A wire protocol, Grok-Bot style: agents route work and questions by
 * appending plain-text directives to the very end of a reply. The harness
 * parses them, strips them from what the user sees, and executes them.
 *
 *   @delegate(to: @tag, task: one-sentence instruction)
 *   @consult(to: @tag, question: judgment call inside the foreman's authority)
 *   @escalate(question for the human)
 */

const DELEGATE_RE =
  /@delegate\(\s*to:\s*@?([A-Za-z0-9_-]+)\s*,\s*task:\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;
const CONSULT_RE =
  /@consult\(\s*to:\s*@?([A-Za-z0-9_-]+)\s*,\s*question:\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;
const ESCALATE_RE = /@escalate\(\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;

export interface ParsedReply {
  /** Reply text with directives removed and trailing whitespace trimmed. */
  clean: string;
  handoff?: Handoff;
  consult?: Consult;
  escalation?: Escalation;
}

export function parseReply(text: string, fromTag: string): ParsedReply {
  let clean = text;
  let handoff: Handoff | undefined;
  let consult: Consult | undefined;
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

  const consultMatch = CONSULT_RE.exec(clean);
  if (consultMatch) {
    const to = consultMatch[1]!.toLowerCase();
    const question = consultMatch[2]!.trim();
    if (to && question) {
      consult = { from: fromTag, to, question };
      clean = clean.replace(CONSULT_RE, "");
    }
  }

  // Escalation outranks everything: a judgment call that escapes the ground
  // rules goes straight to the human and stops the chain.
  const escalateMatch = ESCALATE_RE.exec(clean);
  if (escalateMatch) {
    const question = escalateMatch[1]!.trim();
    if (question) {
      escalation = { from: fromTag, question };
      clean = clean.replace(ESCALATE_RE, "");
      handoff = undefined;
      consult = undefined;
    }
  }

  return { clean: clean.replace(/\s+$/, ""), handoff, consult, escalation };
}
