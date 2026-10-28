// test/guard-foundation.mjs — CR-210 row 8 (check half): the public foundation guard verifies intake's signed receipt.
//
// Runs the packaged entrypoint, `bash scripts/guard.sh foundation`, from a temporary project holding
// .devgenie/intake.json, ARCH.md and docs/ASSUMPTIONS.md. The fixtures in test/fixtures/intake-receipt/ are decisions
// produced and signed by DevGenie's own S_intake (devgenie-core scripts/cr-210-intake-receipt-fixtures.mjs) with a
// throwaway P-256 key; fixture-key.pem is its public half. A marker is the decision plus gate: "intake". The guard is
// copied into a temporary plugin root whose keys/ holds the fixture key; one case runs the real shipped guard against
// the real bundled key. A marker with no receipt (every intake before the server signs them) must behave exactly as
// before (owner ruling HITL-017). No network, no node_modules, no private key. Needs bash, jq, openssl and base64.
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

// m: a marker object, or a string written verbatim.
function guard(m, { guardPath = join(root, "scripts", "guard.sh"), arch = true, assumptions = true } = {}) {
  const proj = join(work, `proj${n++}`);
  mkdirSync(join(proj, ".devgenie"), { recursive: true });
  mkdirSync(join(proj, "docs"), { recursive: true });
  if (arch) writeFileSync(join(proj, "ARCH.md"), "# ARCH\n");
  if (assumptions) writeFileSync(join(proj, "docs", "ASSUMPTIONS.md"), "# Assumptions\n");
  writeFileSync(join(proj, ".devgenie", "intake.json"), typeof m === "string" ? m : JSON.stringify(m, null, 2));
  const r = spawnSync("bash", [guardPath.replace(/\\/g, "/"), "foundation"], { cwd: proj, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const unlocks = (r) => r.code === 0 && r.out === "GATE OK: foundation";
const blocks = (r, text) => r.code === 1 && r.err.includes(text);
const show = (r) => `exit ${r.code}: ${r.out} | ${r.err}`;
const edit = (name, f) => { const m = fx(name); f(m); return m; };
const NOT_VERIFY = "receipt does not verify";
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

console.log("\n[CR-210] V: signed HOLD and FAIL block\n");
r = guard(fx("hold"));
check("signed HOLD blocks", blocks(r, "intake verdict is 'HOLD'"), show(r));
r = guard(fx("fail"));
check("signed FAIL blocks", blocks(r, "intake verdict is 'FAIL'"), show(r));

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
  check(`edited: ${what} blocks`, blocks(r, NOT_VERIFY), show(r));
}

console.log("\n[CR-210] S: the signature\n");
r = guard(edit("pass", (m) => { delete m.receipt.signature; }));
check("receipt without a signature blocks", blocks(r, "receipt is not signed"), show(r));
r = guard(edit("pass", (m) => { m.receipt.signature = "!!!not-base64!!!"; }));
check("malformed signature blocks", blocks(r, "signature is malformed") || blocks(r, NOT_VERIFY), show(r));
r = guard(fx("pass-other-key"));
check("a receipt signed by another key blocks", blocks(r, NOT_VERIFY), show(r));

console.log("\n[CR-210] K: the key set\n");
r = guard(fx("pass"), { guardPath: join(pluginRoot([]), "scripts", "guard.sh") });
check("empty keys/ blocks", blocks(r, "has no gate key"), show(r));
{
  const unrelated = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" });
  r = guard(fx("pass"), { guardPath: join(pluginRoot([unrelated, FIXTURE_KEY]), "scripts", "guard.sh") });
  check("an unrelated key beside the right one still unlocks", unlocks(r), show(r));
}
r = guard(fx("pass"), { guardPath: GUARD });
check("shipped guard and key: a fixture-signed PASS does not verify", blocks(r, NOT_VERIFY), show(r));

console.log("\n[CR-210] O: a marker with no receipt behaves exactly as before (HITL-017)\n");
r = guard({ gate: "intake", verdict: "PASS" });
check("old PASS unlocks", unlocks(r), show(r));
for (const v of ["CONDITIONAL", "HOLD", "FAIL"]) {
  r = guard({ gate: "intake", verdict: v });
  check(`old ${v} blocks as today`, blocks(r, "intake verdict is not PASS"), show(r));
}
r = guard({ gate: "intake" });
check("old marker with no verdict blocks as today", blocks(r, "intake verdict is not PASS"), show(r));
r = guard(edit("pass", (m) => { delete m.receipt; }));
check("new PASS with the receipt deleted takes the old path and unlocks (accepted trade-off)", unlocks(r), show(r));
r = guard(edit("conditional", (m) => { delete m.receipt; }));
check("new CONDITIONAL with the receipt deleted blocks as today", blocks(r, "intake verdict is not PASS"), show(r));
r = guard({ gate: "intake", verdict: "PASS", receipt: null });
check("receipt: null is a receipt and blocks", blocks(r, "receipt is not signed"), show(r));
r = guard({ gate: "intake", verdict: "PASS", receipt: {} });
check("receipt: {} blocks", blocks(r, "receipt is not signed"), show(r));

console.log("\n[CR-210] E: the existing checks still run\n");
r = guard(fx("pass"), { arch: false });
check("signed PASS without ARCH.md blocks", blocks(r, "ARCH.md is missing"), show(r));
r = guard(fx("pass"), { assumptions: false });
check("signed PASS without docs/ASSUMPTIONS.md blocks", blocks(r, "ASSUMPTIONS.md is missing"), show(r));
r = guard(edit("pass", (m) => { delete m.gate; }));
check("a decision without gate: intake blocks", blocks(r, "is not an intake marker"), show(r));

console.log("\n[CR-210] D: escaping\n");
check("the U+007F fixture holds a raw U+007F in a citation path", raw("pass-del-path").includes("\u007f"));
r = guard(fx("pass-del-path"));
check("a citation path holding U+007F verifies and unlocks", unlocks(r), show(r));
{
  // Written verbatim (the generator's bytes plus the gate field), never re-serialised here.
  const text = raw("pass-lone-surrogate-path").replace(/^\{/, '{\n  "gate": "intake",');
  check("the lone-surrogate fixture holds the escape \\ud800", text.includes("\\ud800"));
  r = guard(text);
  check("a lone-surrogate citation path blocks (jq cannot parse it; fail closed)", blocks(r, "is not an intake marker"), show(r));
}

try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort scratch cleanup */ }
console.log(failures ? `\nGUARD-FOUNDATION: FAIL (${failures} failed, ${passed} passed)` : `\nGUARD-FOUNDATION: OK (${passed} passed)`);
process.exit(failures ? 1 : 0);
