// test/new-skill.mjs — CR-207: the /devgenie:new skill writes the files the server returns.
//
// From DevGenie 0.3.2, get_new_prompt returns the fixed project files as files[] ({ path, content }) beside the
// prompt, and the prompt no longer carries their text. This checks the skill tells the model to keep files[] and
// write each entry exactly as returned, create-if-absent, that the Write tool is allowed, and that both manifests
// carry the release version. No network, no node_modules.
//   node test/new-skill.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8").split("\r").join("");
const VERSION = "0.3.4";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

const skill = read("plugins/devgenie/skills/new/SKILL.md");
const allowed = /^allowed-tools:\s*\[(.*)\]\s*$/m.exec(skill)?.[1] ?? "";
check("the skill names files[]", /files\[\]/.test(skill));
check("the skill says to write each entry exactly as returned", /exactly as returned/.test(skill));
check("the skill says create-if-absent", /create-if-absent/.test(skill));
check("the skill says never to retype a body the server sent", /never retype/i.test(skill));
check("allowed-tools lists Write", /(^|[\s,\[])Write([\s,\]]|$)/.test(allowed), allowed);

const plugin = JSON.parse(read("plugins/devgenie/.claude-plugin/plugin.json"));
const market = JSON.parse(read(".claude-plugin/marketplace.json"));
const marketVersion = (market.plugins ?? []).find((p) => p.name === "devgenie")?.version;
check(`plugin.json version is ${VERSION}`, plugin.version === VERSION, `got ${plugin.version}`);
check(`marketplace.json devgenie version is ${VERSION}`, marketVersion === VERSION, `got ${marketVersion}`);

console.log(`\n${failures === 0 ? "NEW-SKILL: OK" : `NEW-SKILL: FAIL (${failures} failed)`}`);
process.exit(failures === 0 ? 0 : 1);
