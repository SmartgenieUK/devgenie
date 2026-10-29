// test/scaffold-skill.mjs — CR-207: the /devgenie:scaffold skill writes the files the server returns.
//
// From DevGenie 0.3.3, get_scaffold_prompt returns session 0's fixed files (the CI workflow, settings.json and the two
// metering hooks) as files[] beside the prompt. The skill keeps files[] and writes each entry exactly as returned,
// create-if-absent; it no longer copies bundled copies of those files, and the release no longer ships them. It keeps
// making the hooks executable and pointing git at them. No network, no node_modules.
//   node test/scaffold-skill.mjs
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8").split("\r").join("");
const VERSION = "0.3.7";
const REMOVED = ["record-tokens.sh", "prepare-commit-msg", "settings.json"];

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

const skill = read("plugins/devgenie/skills/scaffold/SKILL.md");
const allowed = /^allowed-tools:\s*\[(.*)\]\s*$/m.exec(skill)?.[1] ?? "";
check("the skill names files[]", /files\[\]/.test(skill));
check("the skill says to write each entry exactly as returned", /exactly as returned/.test(skill));
check("the skill says create-if-absent", /create-if-absent/.test(skill));
check("the skill says never to retype a body the server sent", /never retype/i.test(skill));
check("allowed-tools lists Write", /(^|[\s,\[])Write([\s,\]]|$)/.test(allowed), allowed);
check(
  "the skill copies none of the bundled metering files",
  !/templates\/project-metrics\/(record-tokens\.sh|prepare-commit-msg|settings\.json)/.test(skill),
);
check("the skill still makes the hooks executable", /chmod \+x \.claude\/hooks\//.test(skill));
check("the skill still points git at the hooks", /git config core\.hooksPath \.claude\/hooks/.test(skill));
for (const f of REMOVED) {
  check(`the release no longer ships templates/project-metrics/${f}`, !existsSync(join(REPO, "plugins", "devgenie", "templates", "project-metrics", f)));
}
check("templates/project-metrics/record-eval-run.sh is still shipped", existsSync(join(REPO, "plugins", "devgenie", "templates", "project-metrics", "record-eval-run.sh")));

const plugin = JSON.parse(read("plugins/devgenie/.claude-plugin/plugin.json"));
const market = JSON.parse(read(".claude-plugin/marketplace.json"));
const marketVersion = (market.plugins ?? []).find((p) => p.name === "devgenie")?.version;
check(`plugin.json version is ${VERSION}`, plugin.version === VERSION, `got ${plugin.version}`);
check(`marketplace.json devgenie version is ${VERSION}`, marketVersion === VERSION, `got ${marketVersion}`);

console.log(`\n${failures === 0 ? "SCAFFOLD-SKILL: OK" : `SCAFFOLD-SKILL: FAIL (${failures} failed)`}`);
process.exit(failures === 0 ? 0 : 1);
