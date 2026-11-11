// test/signin-plugin.mjs — CR-227 slice 4 (0.3.9): sign in from any device.
//
// Pins the server entry (a headersHelper that runs the shipped helper, no oauth block, no static headers), the
// shipped sign-in scripts and setup files, the release version, and that setup's text never says paste and never
// names the helper. Runs the helper against a wrong server address with an empty temp home: it must print
// nothing on stdout and exit 1. No network, no node_modules, no real sign-in.
//   node test/signin-plugin.mjs
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(REPO, p), "utf8").split("\r").join("");
const VERSION = "0.3.9";
const SERVER = "https://devgenie.smartgenie.co.uk/mcp";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

const mcp = JSON.parse(read("plugins/devgenie/.mcp.json"));
const servers = Object.keys(mcp.mcpServers || {});
const entry = mcp.mcpServers?.["devgenie-core"] || {};
check("one server, devgenie-core", servers.length === 1 && servers[0] === "devgenie-core");
check("http to the DevGenie server", entry.type === "http" && entry.url === SERVER);
check("no oauth block and no static headers", !("oauth" in entry) && !("headers" in entry));
check("the headersHelper runs the shipped helper from the plugin root",
  entry.headersHelper === 'node "${CLAUDE_PLUGIN_ROOT}/scripts/headers-helper.mjs"', entry.headersHelper);

for (const p of ["scripts/signin-lib.mjs", "scripts/signin.mjs", "scripts/headers-helper.mjs", "skills/setup/SKILL.md", "skills/setup/setup.mjs"]) {
  check(`ships plugins/devgenie/${p}`, existsSync(join(REPO, "plugins/devgenie", p)));
}

const skill = read("plugins/devgenie/skills/setup/SKILL.md");
check("setup's text never says paste and never names the helper", !/paste|helper|headersHelper|headers-helper/i.test(skill));
check("setup sends sign-in to a terminal of the user's own", /terminal of your own/i.test(skill) && /not through Claude/i.test(skill));

const plugin = JSON.parse(read("plugins/devgenie/.claude-plugin/plugin.json"));
const market = JSON.parse(read(".claude-plugin/marketplace.json"));
check(`plugin.json is ${VERSION}`, plugin.version === VERSION, plugin.version);
check(`marketplace.json is ${VERSION}`, market.plugins?.some((p) => p.version === VERSION));

const home = mkdtempSync(join(tmpdir(), "signin-plugin-"));
const r = spawnSync(process.execPath, [join(REPO, "plugins/devgenie/scripts/headers-helper.mjs")], {
  encoding: "utf8", timeout: 30000,
  env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_MCP_SERVER_URL: "https://example.invalid/mcp" },
});
check("the helper refuses another server address: exit 1, nothing on stdout, the sign-in sentence on stderr",
  r.status === 1 && r.stdout === "" && /DevGenie sign-in needed/.test(r.stderr), `status=${r.status}`);

console.log(`\nSIGNIN-PLUGIN: ${failures ? `FAIL (${failures} failed)` : "OK"}`);
process.exit(failures ? 1 : 0);
