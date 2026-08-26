import type { AgentDef, Consult, Escalation, Handoff } from "./types";

/**
 * The A2A wire protocol, Grok-Bot style: agents route work and questions by
 * appending plain-text directives to the very end of a reply. The harness
 * parses them, strips them from what the user sees, and executes them.
 *
 *   @delegate(to: @tag, task: one-sentence instruction)   (up to 3 per reply)
 *   @consult(to: @tag, question: judgment call inside the foreman's authority)
 *   @escalate(question for the human)
 */

const DELEGATE_RE =
  /@delegate\(\s*to:\s*@?([A-Za-z0-9_-]+)\s*,\s*task:\s*([\s\S]*?)\)\s*(?=$|\r?\n)/gi;
const CONSULT_RE =
  /@consult\(\s*to:\s*@?([A-Za-z0-9_-]+)\s*,\s*question:\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;
const ESCALATE_RE = /@escalate\(\s*([\s\S]*?)\)\s*(?=$|\r?\n)/i;

/** Max delegates executed from a single reply — the parallel dispatch cap. */
export const MAX_DELEGATES_PER_REPLY = 3;

export interface ParsedReply {
  /** Reply text with directives removed and trailing whitespace trimmed. */
  clean: string;
  handoffs: Handoff[];
  consult?: Consult;
  escalation?: Escalation;
}

export function parseReply(text: string, fromTag: string): ParsedReply {
  let clean = text;
  const handoffs: Handoff[] = [];
  let consult: Consult | undefined;
  let escalation: Escalation | undefined;

  for (const match of clean.matchAll(DELEGATE_RE)) {
    if (handoffs.length >= MAX_DELEGATES_PER_REPLY) break;
    const to = match[1]!.toLowerCase();
    const task = match[2]!.trim();
    if (to && task) handoffs.push({ from: fromTag, to, task });
  }
  // Strip every delegate directive (including unparseable extras beyond cap).
  clean = clean.replace(/@delegate\([^)]*\)\s*(?=$|\r?\n)/gi, "");

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
  // rules goes straight to the human and stops the chain — pending delegates
  // and consults are cancelled.
  const escalateMatch = ESCALATE_RE.exec(clean);
  if (escalateMatch) {
    const question = escalateMatch[1]!.trim();
    if (question) {
      escalation = { from: fromTag, question };
      clean = clean.replace(ESCALATE_RE, "");
      handoffs.length = 0;
      consult = undefined;
    }
  }

  return {
    clean: clean.replace(/[ \t]+$/gm, "").replace(/\s+$/, ""),
    handoffs,
    consult,
    escalation,
  };
}
