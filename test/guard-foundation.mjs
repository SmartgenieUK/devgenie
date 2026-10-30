// test/guard-foundation.mjs — CR-210 row 8: the public guard accepts only a signed intake result before foundation.
//
// Runs the packaged entrypoint, `bash scripts/guard.sh foundation` and `bash scripts/guard.sh intake-receipt`, from a
// temporary project holding .devgenie/intake.json (and, for foundation, ARCH.md and docs/ASSUMPTIONS.md). The fixtures
// in test/fixtures/intake-receipt/ are decisions produced and signed by DevGenie's own s_intake, plus two markers the
// served writer wrote from saved decisions (devgenie-core scripts/cr-210-intake-receipt-fixtures.mjs), with a
// throwaway P-256 key; fixture-key.pem is its public half. A marker is the decision plus gate: "intake". The guard is
// copied into a temporary plugin root whose keys/ holds the fixture key; one case runs the real shipped guard against
// the real bundled key. A marker without a verifying receipt blocks (owner ruling HITL-017 as superseded: the old
// intake is discontinued). The foundation and agent-foundation skills' step 1 runs the intake-receipt phase before
// drafting.
// No network, no node_modules, no private key. Needs bash, jq, openssl and base64.
//   node test/guard-foundation.mjs
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join(REPO, "plugins", "devgenie", "scripts", "guard.sh");
const FIX = join(REPO, "test", "fixtures", "intake-receipt");
const SKILL = join(REPO, "plugins", "devgenie", "skills", "foundation", "SKILL.md");
const AGENT_SKILL = join(REPO, "plugins", "devgenie", "skills", "agent-foundation", "SKILL.md");

const missing = ["bash", "jq", "openssl", "base64"].filter((t) => spawnSync("bash", ["-c", `command -v ${t}`]).status !== 0);
if (missing.length) {
  console.error(`GUARD-FOUNDATION: FAIL — missing on PATH: ${missing.join(", ")}` +
    (missing.includes("jq") ? " (jq: winget install jqlang.jq · brew install jq · apt-get install jq)" : ""));
  process.exit(1);
}

let failures = 0, passed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? "\n         " + detail : ""}`); }
}

const work = mkdtempSync(join(tmpdir(), "cr210-"));
const raw = (name) => readFileSync(join(FIX, `${name}.json`), "utf8");
const fx = (name) => ({ ...JSON.parse(raw(name)), gate: "intake" });
const writer = (name) => readFileSync(join(FIX, `writer-${name}.marker.json`), "utf8");

let n = 0;
function pluginRoot(keyPems) {
  const root = join(work, `plugin${n++}`);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "keys"), { recursive: true });
  copyFileSync(GUARD, join(root, "scripts", "guard.sh"));
  keyPems.forEach((p, i) => writeFileSync(join(root, "keys", `k${i}.pem`), p));
  return root;
}
const FIXTURE_KEY = readFileSync(join(FIX, "fixture-key.pem"), "utf8");
const root = pluginRoot([FIXTURE_KEY]);

function project(m, { arch = true, assumptions = true } = {}) {
  const proj = join(work, `proj${n++}`);
  mkdirSync(join(proj, ".devgenie"), { recursive: true });
  mkdirSync(join(proj, "docs"), { recursive: true });
  if (arch) writeFileSync(join(proj, "ARCH.md"), "# ARCH\n");
  if (assumptions) writeFileSync(join(proj, "docs", "ASSUMPTIONS.md"), "# Assumptions\n");
  if (m !== null) writeFileSync(join(proj, ".devgenie", "intake.json"), typeof m === "string" ? m : JSON.stringify(m, null, 2));
  return proj;
}
// m: a marker object, a string written verbatim, or null for no marker.
function guard(m, { guardPath = join(root, "scripts", "guard.sh"), phase = "foundation", ...opts } = {}) {
  const r = spawnSync("bash", [guardPath.replace(/\\/g, "/"), phase], { cwd: project(m, opts), encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const unlocks = (r, phase = "foundation") => r.code === 0 && r.out === `GATE OK: ${phase}`;
const blocks = (r, text) => r.code === 1 && r.err.includes(text);
// A block about the intake result names the re-run.
const rerun = (r, text) => blocks(r, text) && r.err.includes("/devgenie:intake");
const show = (r) => `exit ${r.code}: ${r.out} | ${r.err}`;
const edit = (name, f) => { const m = fx(name); f(m); return m; };
const NOT_VERIFY = "receipt does not verify";
const NO_RECEIPT = "has no signed receipt";
let r;

console.log("\n[CR-210] U: signed PASS and CONDITIONAL unlock\n");
{
  const files = JSON.stringify(fx("pass").card);
  check("the PASS fixture's card cites an astral, a U+E000, a CJK and an accented path",
    files.includes("😀") && files.includes("") && files.includes("日本語") && files.includes("café"));
}
r = guard(fx("pass"));
check("signed PASS unlocks", unlocks(r), show(r));
r = guard(fx("conditional"));
check("signed CONDITIONAL unlocks", unlocks(r), show(r));

console.log("\n[CR-210] W: markers the served writer wrote from saved s_intake results unlock\n");
r = guard(writer("pass"));
check("served-writer PASS marker unlocks", unlocks(r), show(r));
r = guard(writer("conditional"));
check("served-writer CONDITIONAL marker unlocks", unlocks(r), show(r));

console.log("\n[CR-210] V: signed HOLD and FAIL block\n");
r = guard(fx("hold"));
check("signed HOLD blocks", rerun(r, "intake verdict is 'HOLD'"), show(r));
r = guard(fx("fail"));
check("signed FAIL blocks", rerun(r, "intake verdict is 'FAIL'"), show(r));

console.log("\n[CR-210] T: an edited receipt blocks\n");
const tamper = [
  ["verdict HOLD -> PASS", "hold", (m) => { m.verdict = "PASS"; }],
  ["verdict HOLD -> CONDITIONAL", "hold", (m) => { m.verdict = "CONDITIONAL"; }],
  ["verdict FAIL -> PASS", "fail", (m) => { m.verdict = "PASS"; }],
  ["a card answer gains a value", "pass", (m) => { m.card.solution_type.values.push("cli"); }],
  ["a card answer's status", "pass", (m) => { m.card.users = { status: "answered", values: ["staff"], citations: [{ file: "docs/inputs/brief.md", line: 1 }] }; }],
  ["a citation line", "pass", (m) => { m.card.solution_type.citations[0].line += 1; }],
  ["a choice's force", "pass", (m) => { m.card.preferences.choices[3].force = "prefer"; }],
  ["receipt.card_sha256", "pass", (m) => { m.receipt.card_sha256 = "0".repeat(64); }],
  ["receipt.ratings_sha256", "pass", (m) => { m.receipt.ratings_sha256 = "0".repeat(64); }],
  ["an open_for_foundation entry removed", "pass", (m) => { m.open_for_foundation.pop(); }],
  ["receipt.receipt_id", "pass", (m) => { m.receipt.receipt_id = "irc_0000000000000000"; }],
  ["receipt.decided_at", "pass", (m) => { m.receipt.decided_at = "2020-01-01T00:00:00.000Z"; }],
  ["facts.personal_data flipped", "pass", (m) => { m.facts.personal_data = true; }],
  ["depth", "pass", (m) => { m.depth = "mvp"; }],
  ["rule_version", "pass", (m) => { m.rule_version = "intake-rule/9"; }],
  ["HOLD with next_gap cleared and verdict PASS", "hold", (m) => { m.next_gap = null; m.verdict = "PASS"; }],
];
for (const [what, base, f] of tamper) {
  r = guard(edit(base, f));
  check(`edited: ${what} blocks`, rerun(r, NOT_VERIFY), show(r));
}

console.log("\n[CR-210] S: the signature\n");
r = guard(edit("pass", (m) => { delete m.receipt.signature; }));
check("receipt without a signature blocks", rerun(r, NO_RECEIPT), show(r));
r = guard(edit("pass", (m) => { m.receipt.signature = "!!!not-base64!!!"; }));
check("malformed signature blocks", rerun(r, "signature is malformed") || rerun(r, NOT_VERIFY), show(r));
r = guard(fx("pass-other-key"));
check("a receipt signed by another key blocks", rerun(r, NOT_VERIFY), show(r));

console.log("\n[CR-210] K: the key set\n");
r = guard(fx("pass"), { guardPath: join(pluginRoot([]), "scripts", "guard.sh") });
check("empty keys/ blocks", blocks(r, "has no gate key"), show(r));
{
  const unrelated = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" });
  r = guard(fx("pass"), { guardPath: join(pluginRoot([unrelated, FIXTURE_KEY]), "scripts", "guard.sh") });
  check("an unrelated key beside the right one still unlocks", unlocks(r), show(r));
}
r = guard(fx("pass"), { guardPath: GUARD });
check("shipped guard and key: a fixture-signed PASS does not verify", rerun(r, NOT_VERIFY), show(r));

console.log("\n[CR-210] O: a result without a signed receipt blocks (HITL-017 as superseded)\n");
for (const v of ["PASS", "CONDITIONAL", "HOLD", "FAIL"]) {
  r = guard({ gate: "intake", verdict: v });
  check(`old ${v} with no receipt blocks`, rerun(r, NO_RECEIPT), show(r));
}
r = guard({ gate: "intake" });
check("old marker with no verdict blocks", rerun(r, NO_RECEIPT), show(r));
r = guard(edit("pass", (m) => { delete m.receipt; }));
check("signed PASS with the receipt deleted blocks", rerun(r, NO_RECEIPT), show(r));
r = guard(edit("conditional", (m) => { delete m.receipt; }));
check("signed CONDITIONAL with the receipt deleted blocks", rerun(r, NO_RECEIPT), show(r));
for (const [label, receipt] of [["null", null], ["{}", {}], ['"x"', "x"]]) {
  r = guard({ gate: "intake", verdict: "PASS", receipt });
  check(`receipt: ${label} blocks`, rerun(r, NO_RECEIPT), show(r));
}
r = guard(null);
check("no intake result blocks", rerun(r, "no intake result"), show(r));

console.log("\n[CR-210] E: the existing checks still run\n");
r = guard(fx("pass"), { arch: false });
check("signed PASS without ARCH.md blocks", blocks(r, "ARCH.md is missing"), show(r));
r = guard(fx("pass"), { assumptions: false });
check("signed PASS without docs/ASSUMPTIONS.md blocks", blocks(r, "ASSUMPTIONS.md is missing"), show(r));
r = guard(edit("pass", (m) => { delete m.gate; }));
check("a decision without gate: intake blocks", rerun(r, "is not an intake marker"), show(r));

console.log("\n[CR-210] D: escaping\n");
check("the U+007F fixture holds a raw U+007F in a citation path", raw("pass-del-path").includes("\u007f"));
r = guard(fx("pass-del-path"));
check("a citation path holding U+007F verifies and unlocks", unlocks(r), show(r));
{
  // Written verbatim (the generator's bytes plus the gate field), never re-serialised here. s_intake refuses such a
  // path, so this is a forged marker; the guard must fail closed.
  const text = raw("pass-lone-surrogate-path").replace(/^\{/, '{\n  "gate": "intake",');
  check("the lone-surrogate fixture holds the escape \\ud800", text.includes("\\ud800"));
  r = guard(text);
  check("a lone-surrogate citation path blocks (jq cannot parse it; fail closed)", rerun(r, "is not an intake marker"), show(r));
}

console.log("\n[CR-210] P: the intake-receipt phase (the check before drafting; no ARCH.md needed)\n");
const pre = (m) => guard(m, { phase: "intake-receipt", arch: false, assumptions: false });
r = pre(fx("conditional"));
check("intake-receipt: signed CONDITIONAL, no ARCH.md, passes", unlocks(r, "intake-receipt"), show(r));
r = pre(writer("pass"));
check("intake-receipt: served-writer PASS passes", unlocks(r, "intake-receipt"), show(r));
r = pre(fx("hold"));
check("intake-receipt: signed HOLD blocks", rerun(r, "intake verdict is 'HOLD'"), show(r));
r = pre({ gate: "intake", verdict: "PASS" });
check("intake-receipt: an old PASS with no receipt blocks", rerun(r, NO_RECEIPT), show(r));
r = pre(edit("hold", (m) => { m.verdict = "PASS"; }));
check("intake-receipt: an edited marker blocks", rerun(r, NOT_VERIFY), show(r));
r = pre(null);
check("intake-receipt: no intake result blocks", rerun(r, "no intake result"), show(r));

console.log("\n[CR-210] F: the foundation skill's step 1 runs the intake-receipt phase\n");
{
  const skill = readFileSync(SKILL, "utf8").replace(/\r\n/g, "\n");
  const CMD = 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" intake-receipt';
  const step1 = skill.split(/\n2\. /)[0];
  check("step 1 runs the intake-receipt phase", step1.includes(CMD));
  check("no skill-side verdict check is left", !skill.includes('.verdict=="PASS"') && !/jq -e '[^']*verdict/.test(skill));
  const runStep1 = (m) => {
    const res = spawnSync("bash", ["-c", CMD], {
      cwd: project(m, { arch: false, assumptions: false }), encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root.replace(/\\/g, "/") },
    });
    return { code: res.status, out: (res.stdout || "").trim(), err: (res.stderr || "").trim() };
  };
  r = runStep1(fx("conditional"));
  check("step 1 lets a signed CONDITIONAL reach drafting", unlocks(r, "intake-receipt"), show(r));
  r = runStep1({ gate: "intake", verdict: "PASS" });
  check("step 1 stops an unsigned PASS before drafting", rerun(r, NO_RECEIPT), show(r));
}

console.log("\n[CR-210] A: the agent-foundation skill's step 1 runs the intake-receipt phase\n");
{
  const skill = readFileSync(AGENT_SKILL, "utf8").replace(/\r\n/g, "\n");
  const CMD = 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" intake-receipt';
  const step1 = skill.split(/\n2\. /)[0];
  // The first fenced block in step 1, run as written: the witness exercises the skill's own text, not a constant.
  const fences = step1.split("\n").reduce((at, line, i) => (line.trim().startsWith("```") ? [...at, i] : at), []);
  const block = fences.length >= 2 ? step1.split("\n").slice(fences[0] + 1, fences[1]).join("\n") : "";
  check("agent-foundation step 1 runs the intake-receipt phase", block.trim() === CMD, JSON.stringify(block.trim()));
  check("agent-foundation holds no skill-side verdict check", !skill.includes('.verdict=="PASS"') && !/jq -e '[^']*verdict/.test(skill));
  const runAgentStep1 = (m) => {
    const res = spawnSync("bash", ["-c", block || "exit 99"], {
      cwd: project(m, { arch: false, assumptions: false }), encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root.replace(/\\/g, "/") },
    });
    return { code: res.status, out: (res.stdout || "").trim(), err: (res.stderr || "").trim() };
  };
  r = runAgentStep1(fx("conditional"));
  check("agent-foundation step 1 lets a signed CONDITIONAL reach drafting", unlocks(r, "intake-receipt"), show(r));
  r = runAgentStep1(writer("pass"));
  check("agent-foundation step 1 lets a served-writer PASS reach drafting", unlocks(r, "intake-receipt"), show(r));
  r = runAgentStep1({ gate: "intake", verdict: "PASS" });
  check("agent-foundation step 1 stops an unsigned PASS before drafting", rerun(r, NO_RECEIPT), show(r));
  r = runAgentStep1(edit("hold", (m) => { m.verdict = "PASS"; }));
  check("agent-foundation step 1 stops an edited marker before drafting", rerun(r, NOT_VERIFY), show(r));
  r = runAgentStep1(null);
  check("agent-foundation step 1 stops when there is no intake result", rerun(r, "no intake result"), show(r));
}
try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort scratch cleanup */ }
console.log(failures ? `\nGUARD-FOUNDATION: FAIL (${failures} failed, ${passed} passed)` : `\nGUARD-FOUNDATION: OK (${passed} passed)`);
process.exit(failures ? 1 : 0);
