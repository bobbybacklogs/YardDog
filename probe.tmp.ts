import { defaultSkillRoots, discoverSkills } from "skillswap";

const roots = await defaultSkillRoots();
const specs = await discoverSkills(roots);
const s = specs.find((x) => x.companionFiles.length > 0) ?? specs[0];
if (s) {
  console.log("name:", s.name);
  console.log("provenance.path:", s.provenance?.path);
  console.log("companions:", JSON.stringify(s.companionFiles));
}
