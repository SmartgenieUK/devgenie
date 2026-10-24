// test/markers-derived.mjs — CR-207 slice 4: the guard-trusted markers are script-written, never typed by the model.
//
// The guards read three markers: .devgenie/gate.json, intake.json and agent-gate.json. From DevGenie 0.3.4 each has a
// writer: the gate and agent-gate skills save the tool response exactly as returned and run
// scripts/write-marker.sh, which copies the server's fields; the intake marker is written by a script DevGenie serves
// with get_intake_prompt (checked in devgenie-core). No skill has the model write a marker, and no skill calls
// get_agent_gate_prompt (the served agent-rating-gate prompt still has the model write agent-gate.json, an exception
// owed to CR-064 F5 that holds only while nothing here fetches it). The written markers are run through the unchanged
// guard. No network, no node_modules, no real private key. Needs bash, jq, openssl and base64 on PATH.
//   node test/markers-derived.mjs
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(REPO, "plugins", "devgenie");
const GUARD = join(PLUGIN, "scripts", "guard.sh");
const WRITER = join(PLUGIN, "scripts", "write-marker.sh");
const read = (p) => readFileSync(p, "utf8").split("\r").join("");
const VERSION = "0.3.5";

const missing = ["bash", "jq", "openssl", "base64"].filter((t) => spawnSync("bash", ["-c", `command -v ${t}`]).status !== 0);
if (missing.length) {
  console.error(`MARKERS-DERIVED: FAIL — missing on PATH: ${missing.join(", ")}`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

// [1] Inventory: the markers the guard reads, and the writer each one has.
console.log("\n[1] every marker the guard reads has a writer");
const guardText = read(GUARD);
const read_ = [...new Set([...guardText.matchAll(/\.devgenie\/([a-z-]+\.json)/g)].map((m) => m[1]))].sort();
const WRITERS = {
  "gate.json": "scripts/write-marker.sh gate",
  "intake.json": "served by get_intake_prompt (devgenie-core test/new-served-flow.mjs [11])",
  "agent-gate.json": "scripts/write-marker.sh agent-gate",
};
check("the guard reads exactly gate.json, intake.json and agent-gate.json", JSON.stringify(read_) === JSON.stringify(Object.keys(WRITERS).sort()), read_.join(", "));
const writerText = existsSync(WRITER) ? read(WRITER) : "";
check("scripts/write-marker.sh exists", writerText !== "");
for (const [marker, w] of Object.entries(WRITERS)) {
  const sub = /^scripts\/write-marker\.sh (\S+)$/.exec(w)?.[1];
  if (sub) check(`${marker}: write-marker.sh has a '${sub}' subcommand`, new RegExp(`^\\s*${sub}\\)`, "m").test(writerText));
}

// [2] Skills: none has the model write a marker, none mentions design.json, none fetches the served agent gate prompt.
console.log("\n[2] no skill has the model write a guard-trusted marker");
const skillFiles = readdirSync(join(PLUGIN, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PLUGIN, "skills", d.name, "SKILL.md")))
  .map((d) => d.name);
const MARKER_KEYS = { "gate.json": /"signature"/, "intake.json": /"gate"\s*:\s*"intake"/, "agent-gate.json": /"grade"/, "design.json": /"design\// };
const NAMES_WRITER = /write-marker\.sh|write-intake-marker\.sh/;
function authoringHits(text, marker) {
  const ls = text.split("\n");
  const re = new RegExp(`\\b(write|create|record)\\b[^\\n]{0,80}\\.devgenie\\/${marker.replace(".", "\\.")}`, "i");
  const hits = [];
  ls.forEach((line, i) => {
    if (!re.test(line)) return;
    if (!NAMES_WRITER.test(line)) return void hits.push(i + 1);
    const fence = ls.slice(i + 1, i + 4).findIndex((l) => l.trim().startsWith("```"));
    if (fence < 0) return;
    const start = i + 2 + fence;
    const end = ls.findIndex((l, k) => k >= start && l.trim().startsWith("```"));
    if (MARKER_KEYS[marker].test(ls.slice(start, end < 0 ? ls.length : end).join("\n"))) hits.push(i + 1);
  });
  return hits;
}
for (const name of skillFiles) {
  const text = read(join(PLUGIN, "skills", name, "SKILL.md"));
  for (const marker of Object.keys(MARKER_KEYS)) {
    const hits = authoringHits(text, marker);
    check(`skills/${name} has the model write no ${marker}`, hits.length === 0, `lines ${hits.join(", ")}`);
  }
  check(`skills/${name} does not call get_agent_gate_prompt (the CR-064 F5 exception's condition)`, !text.includes("get_agent_gate_prompt"));
}
check("design.json appears in no guard and no skill", !guardText.includes("design.json") &&
  skillFiles.every((s) => !read(join(PLUGIN, "skills", s, "SKILL.md")).includes("design.json")));
const gateSkill = read(join(PLUGIN, "skills", "gate", "SKILL.md"));
const agentSkill = read(join(PLUGIN, "skills", "agent-gate", "SKILL.md"));
check("the gate skill saves the response exactly as returned and runs the writer",
  /exactly as returned/.test(gateSkill) && gateSkill.includes(".devgenie/gate-response.json") && /write-marker\.sh" gate /.test(gateSkill));
check("the agent-gate skill saves the response exactly as returned and runs the writer",
  /exactly as returned/.test(agentSkill) && agentSkill.includes(".devgenie/agent-gate-response.json") && /write-marker\.sh" agent-gate /.test(agentSkill));

// A project directory with the saved response, the writer run in it.
const work = mkdtempSync(join(tmpdir(), "markers-"));
let n = 0;
function runWriter(args, responseName, response) {
  const proj = join(work, `proj${n++}`);
  mkdirSync(join(proj, ".devgenie"), { recursive: true });
  if (response !== undefined) writeFileSync(join(proj, ".devgenie", responseName), typeof response === "string" ? response : JSON.stringify(response, null, 2));
  const r = spawnSync("bash", [WRITER.replace(/\\/g, "/"), ...args], { cwd: proj, encoding: "utf8" });
  return { proj, code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const markerAt = (proj, name) => (existsSync(join(proj, ".devgenie", name)) ? readFileSync(join(proj, ".devgenie", name), "utf8") : null);
function guardIn(proj, phase, root) {
  const r = spawnSync("bash", [join(root, "scripts", "guard.sh").replace(/\\/g, "/"), phase], { cwd: proj, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// [3] The gate writer, end to end: a response signed as the server signs it, written, then the unchanged guard.
console.log("\n[3] gate: the written marker unlocks the unchanged guard");
const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
const root = join(work, "plugin");
mkdirSync(join(root, "scripts"), { recursive: true });
mkdirSync(join(root, "keys"), { recursive: true });
copyFileSync(GUARD, join(root, "scripts", "guard.sh"));
writeFileSync(join(root, "keys", "k0.pem"), key.publicKey.export({ type: "spki", format: "pem" }));
const PROJECT = "demo";
const fields = {
  verdict: "PASS", independent: true, scope: "mvp", grade: "B", receipt_id: "rcpt_0123456789abcdef",
  rated_at: "2026-10-24T10:00:00.000Z", methodology_version: "2.4.0", arch_sha256: "a".repeat(64),
};
const canonical = (f, project) => JSON.stringify([f.verdict, f.independent, f.scope, f.grade, f.receipt_id, project, f.rated_at, f.methodology_version, f.arch_sha256]);
const response = {
  ...fields, elements: [], load_bearing: [], register_rating: 2, remediation: [], deferred: [], gaps: [], summary: "s",
  signature: sign("sha256", Buffer.from(canonical(fields, PROJECT)), key.privateKey).toString("base64"),
};
let w = runWriter(["gate", ".devgenie/gate-response.json", PROJECT], "gate-response.json", response);
check("write-marker.sh gate exits 0", w.code === 0, w.out);
const written = markerAt(w.proj, "gate.json");
const parsed = written ? JSON.parse(written) : {};
check("the gate marker has exactly the eleven keys",
  JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify([...Object.keys(fields), "project", "signature", "date"].sort()), Object.keys(parsed).join(","));
check("the gate marker copies the response's fields, the given project and the rated date",
  Object.keys(fields).every((k) => parsed[k] === fields[k]) && parsed.signature === response.signature && parsed.project === PROJECT && parsed.date === "2026-10-24");
let g = guardIn(w.proj, "scaffold", root);
check("the unchanged guard unlocks the written gate marker", g.code === 0 && /UNLOCK mvp/.test(g.out), g.out);
const refusals = [
  ["a response without a signature", (() => { const r = { ...response }; delete r.signature; return r; })(), PROJECT],
  ["an error envelope", { error: { code: "UPGRADE_REQUIRED", message: "x" } }, PROJECT],
  ["an empty project", response, ""],
  ["invalid JSON", "{ not json\n", PROJECT],
];
for (const [label, resp, project] of refusals) {
  w = runWriter(["gate", ".devgenie/gate-response.json", project], "gate-response.json", resp);
  check(`gate writer refuses ${label}: exit 1, no marker`, w.code === 1 && markerAt(w.proj, "gate.json") === null && /DEVGENIE: .*\.devgenie\/gate\.json was not written\./.test(w.out), w.out);
}
w = runWriter(["gate", ".devgenie/gate-response.json"], "gate-response.json", response);
check("a missing argument is a usage error: exit 2", w.code === 2, w.out);
w = runWriter(["design", ".devgenie/x.json"], "x.json", {});
check("an unknown subcommand is a usage error: exit 2", w.code === 2, w.out);

// [4] The agent-gate writer, end to end.
console.log("\n[4] agent-gate: the written marker passes the unchanged guard");
const agentMarker = { verdict: "PASS", grade: "A", date: "2026-10-24", independent: true };
const agentResponse = { verdict: "PASS", tier: "agent", grade: "A", elements: [], marker: agentMarker, audit: { receipt_id: "rcpt_x" }, metering: null };
w = runWriter(["agent-gate", ".devgenie/agent-gate-response.json"], "agent-gate-response.json", agentResponse);
check("write-marker.sh agent-gate exits 0", w.code === 0, w.out);
const aw = markerAt(w.proj, "agent-gate.json");
check("the agent-gate marker equals the response's marker", aw !== null && JSON.stringify(JSON.parse(aw)) === JSON.stringify(agentMarker), aw ?? "");
g = guardIn(w.proj, "agent-scaffold", root);
check("the unchanged guard passes the written agent-gate marker", g.code === 0, g.out);
w = runWriter(["agent-gate", ".devgenie/agent-gate-response.json"], "agent-gate-response.json", { verdict: "PASS", tier: "agent" });
check("agent-gate writer refuses a response without a marker: exit 1, no marker",
  w.code === 1 && markerAt(w.proj, "agent-gate.json") === null && /agent-gate\.json was not written\./.test(w.out), w.out);

// [5] Versions.
console.log("\n[5] versions");
const plugin = JSON.parse(read(join(PLUGIN, ".claude-plugin", "plugin.json")));
const market = JSON.parse(read(join(REPO, ".claude-plugin", "marketplace.json")));
check(`plugin.json version is ${VERSION}`, plugin.version === VERSION, `got ${plugin.version}`);
check(`marketplace.json devgenie version is ${VERSION}`, (market.plugins ?? []).find((p) => p.name === "devgenie")?.version === VERSION);

console.log(`\n${failures === 0 ? "MARKERS-DERIVED: OK" : `MARKERS-DERIVED: FAIL (${failures} failed)`}`);
process.exit(failures === 0 ? 0 : 1);
