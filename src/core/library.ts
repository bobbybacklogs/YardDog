import { discoverSkills, loadSkill, type SkillSpec } from "skillswap";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * The skill library — job-scoped know-how loaded from local agent skill
 * directories (via skillswap) and bolted onto whichever workers take the job.
 *
 * Unlike temps (session-scoped labor), skills attach per job: they ride the
 * send() call, get injected into participating agents' system prompts, and
 * their companion files are staged inside the workdir so confined tools
 * (read_file etc.) can open them.
 */

/** Superset of skillswap's defaultSkillRoots(): also scans user-level vendor dirs. */
export async function yardSkillRoots(projectRoot?: string): Promise<string[]> {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  const defaults = await import("skillswap").then((m) => m.defaultSkillRoots(projectRoot));
  if (!home) return defaults;
  const extra = [".agents", ".claude", ".codex", ".github", ".gemini", ".copilot"].map((v) =>
    path.join(home, v, "skills"),
  );
  return [...new Set([...defaults, ...extra])];
}

export interface SkillListing {
  name: string;
  description: string;
  bodyChars: number;
  companions: number;
  sourcePath: string;
}

export async function discoverSkillLibrary(projectRoot?: string): Promise<SkillListing[]> {
  const roots = await yardSkillRoots(projectRoot);
  const specs = await discoverSkills(roots);
  return specs.map((s) => ({
    name: s.name,
    description: s.description ?? "",
    bodyChars: s.body.length,
    companions: s.companionFiles.length,
    sourcePath: s.provenance?.path ?? "",
  }));
}

/** Per-skill prompt budget — bodies longer than this get truncated with a note. */
const MAX_SKILL_BODY_CHARS = 6000;

/**
 * Resolve skill names from the library into specs, stage their companion
 * files under <workdir>/.yarddog/staged/<name>/, and build the prompt
 * injection block. Throws if any requested skill is unknown.
 */
export async function prepareSkills(
  names: string[],
  workdir: string,
): Promise<{ injection: string; specs: SkillSpec[] }> {
  if (names.length === 0) return { injection: "", specs: [] };
  const roots = await yardSkillRoots(workdir);
  const available = await discoverSkills(roots);
  const blocks: string[] = [];

  for (const name of names) {
    const spec = available.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!spec) {
      throw new Error(`unknown skill "${name}" — run \`yarddog skills\` to see the library`);
    }
    // Full spec load (description/body/companions resolved against its dir).
    // provenance.path points at the skill directory itself.
    const specDir = spec.provenance?.path;
    const full = specDir ? await loadSkill(specDir) : spec;

    let body = full.body.trim();
    if (body.length > MAX_SKILL_BODY_CHARS) {
      body =
        body.slice(0, MAX_SKILL_BODY_CHARS) +
        `\n[...truncated — ${full.body.length} chars total. Companion files may contain more.]`;
    }

    const stagedRel = await stageCompanions(full, workdir);
    const lines = [
      `[SKILL: ${full.name}]`,
      full.description ? `Purpose: ${full.description}` : "",
      "",
      body,
    ];
    if (stagedRel) {
      lines.push(`Companion files staged at ${stagedRel} (readable with read_file).`);
    }
    if (full.allowedTools && full.allowedTools.length > 0) {
      lines.push(`This skill references tools (${full.allowedTools.join(", ")}) — use your closest equivalents.`);
    }
    blocks.push(lines.filter((l) => l !== "").join("\n"));
  }

  return {
    injection: `[JOB SKILLS — follow these while working on this job]\n\n${blocks.join("\n\n")}`,
    specs: available.filter((s) => names.some((n) => n.toLowerCase() === s.name.toLowerCase())),
  };
}

async function stageCompanions(spec: SkillSpec, workdir: string): Promise<string | null> {
  if (spec.companionFiles.length === 0 || !spec.provenance?.path) return null;
  const srcDir = spec.provenance.path; // the skill directory itself
  const destRel = path.join(".yarddog", "staged", slugify(spec.name));
  const destAbs = path.join(workdir, destRel);
  await mkdir(destAbs, { recursive: true });
  for (const file of spec.companionFiles) {
    // companionFiles are absolute paths; preserve their structure relative to
    // the skill directory so body references stay meaningful after staging.
    const rel = path.isAbsolute(file) ? path.relative(srcDir, file) : file;
    if (!rel || rel.startsWith("..")) continue; // escapes the skill dir — skip
    const dest = path.join(destAbs, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(file, dest, { recursive: true });
  }
  return destRel.split(path.sep).join("/");
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "skill"
  );
}
