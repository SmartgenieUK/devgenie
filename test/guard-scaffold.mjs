// test/guard-scaffold.mjs — BUG-09: the public scaffold guard verifies DevGenie's gate signature; CR-210 row 8: it
// also verifies the signed intake receipt, first.
//
// Runs the packaged entrypoint, `bash scripts/guard.sh scaffold [scope]`, from a temporary project holding
// .devgenie/gate.json and .devgenie/intake.json. Gate markers are signed here exactly as the server signs them
// (canonicalGate: a fixed-order JSON array, nine elements with arch_sha256, eight on a pre-v1.9 marker; ES256 DER
// signature, base64) with throwaway P-256 key pairs. Intake markers are the fixtures in test/fixtures/intake-receipt/
// (signed by DevGenie's own s_intake with a throwaway key; devgenie-core scripts/cr-210-intake-receipt-fixtures.mjs);
// unless a case says otherwise a project holds the served writer's PASS marker. The guard is copied into a temporary
// plugin root whose keys/ holds the throwaway public keys; two cases run the real plugins/devgenie/scripts/guard.sh
// against the real bundled key. No network, no node_modules, no real private key. Needs bash, jq, openssl and base64.
//   node test/guard-scaffold.mjs
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = join(REPO, "plugins", "devgenie", "scripts", "guard.sh");
const KEY = join(REPO, "plugins", "devgenie", "keys", "gate-pub-9bed85f9.pem");
const PINNED = [
  "-----BEGIN PUBLIC KEY-----",
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/+RCEFrutHd36JbBxZZClaMGas/I",
  "SV77/uM5f6gJrnPlpQUaL6wOCa1qw4d6jXL8mdeeX7Ke4WAPw1eikGAV8A==",
  "-----END PUBLIC KEY-----",
].join("\n");

// The tools come first, loud: a missing tool fails the run, it never skips.
const missing = ["bash", "jq", "openssl", "base64"].filter((t) => spawnSync("bash", ["-c", `command -v ${t}`]).status !== 0);
if (missing.length) {
  console.error(`GUARD-SCAFFOLD: FAIL — missing on PATH: ${missing.join(", ")}` +
    (missing.includes("jq") ? " (jq: winget install jqlang.jq · brew install jq · apt-get install jq)" : ""));
  process.exit(1);
}

let failures = 0, passed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? "\n         " + detail : ""}`); }
}

const work = mkdtempSync(join(tmpdir(), "bug09-"));
const pem = (k) => k.export({ type: "spki", format: "pem" });
const main = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });

// canonicalGate — the exact bytes the server signs.
function canonical(m) {
  const base = [m.verdict, m.independent, m.scope, m.grade, m.receipt_id, m.project, m.rated_at, m.methodology_version];
  return JSON.stringify("arch_sha256" in m ? [...base, m.arch_sha256] : base);
}
const signed = (m, key = main.privateKey) => ({ ...m, signature: sign("sha256", Buffer.from(canonical(m)), key).toString("base64") });
function marker(scope, { legacy = false } = {}) {
  const m = {
    verdict: "PASS", independent: true, scope, grade: "B", receipt_id: "rcpt_0123456789abcdef", project: "demo",
    rated_at: "2026-10-23T10:00:00.000Z", methodology_version: "1.0", date: "2026-10-23",
  };
  if (!legacy) m.arch_sha256 = "a".repeat(64);
  return m;
}

// The intake fixtures (CR-210 row 8): signed s_intake decisions and served-writer markers, and their public key.
const FIX = join(REPO, "test", "fixtures", "intake-receipt");
const FIXTURE_KEY = readFileSync(join(FIX, "fixture-key.pem"), "utf8");
const fx = (name) => ({ ...JSON.parse(readFileSync(join(FIX, `${name}.json`), "utf8")), gate: "intake" });
const writer = (name) => readFileSync(join(FIX, `writer-${name}.marker.json`), "utf8");
const GOOD_INTAKE = writer("pass");

// A temporary plugin root: scripts/guard.sh copied from the package, keys/ holding the given public keys (KeyObjects
// or PEM text). Every root also holds the intake fixture key unless asked not to.
let n = 0;
function pluginRoot(keys, { intakeKey = true } = {}) {
  const root = join(work, `plugin${n++}`);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "keys"), { recursive: true });
  copyFileSync(GUARD, join(root, "scripts", "guard.sh"));
  keys.forEach((k, i) => writeFileSync(join(root, "keys", `k${i}.pem`), typeof k === "string" ? k : pem(k)));
  if (intakeKey && keys.length) writeFileSync(join(root, "keys", "intake-fixture.pem"), FIXTURE_KEY);
  return root;
}
const root = pluginRoot([main.publicKey]);

// m: the gate marker (null for none); intake: the intake marker, an object or text written verbatim, or null for none.
function guard(m, { args = [], guardPath = join(root, "scripts", "guard.sh"), intake = GOOD_INTAKE } = {}) {
  const proj = join(work, `proj${n++}`);
  mkdirSync(join(proj, ".devgenie"), { recursive: true });
  if (m !== null) writeFileSync(join(proj, ".devgenie", "gate.json"), JSON.stringify(m, null, 2));
  if (intake !== null) writeFileSync(join(proj, ".devgenie", "intake.json"), typeof intake === "string" ? intake : JSON.stringify(intake, null, 2));
  const r = spawnSync("bash", [guardPath.replace(/\\/g, "/"), "scaffold", ...args], { cwd: proj, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const unlocks = (r, scope) => r.code === 0 && r.out === `UNLOCK ${scope}`;
const blocks = (r, text) => r.code === 1 && r.err.includes(text);
const show = (r) => `exit ${r.code}: ${r.out} | ${r.err}`;
let r;

console.log("\n[BUG-09] signed markers unlock\n");
r = guard(signed(marker("mvp")));
check("valid nine-element marker unlocks (mvp)", unlocks(r, "mvp"), show(r));
r = guard(signed(marker("production")));
check("valid nine-element marker unlocks (production)", unlocks(r, "production"), show(r));
r = guard(signed(marker("mvp", { legacy: true })));
check("valid eight-element (pre-v1.9) marker unlocks", unlocks(r, "mvp"), show(r));

console.log("\n[BUG-09] unsigned, edited and foreign markers block\n");
r = guard(marker("mvp"));
check("unsigned PASS blocks", blocks(r, "the gate result is not signed"), show(r));
r = guard({ ...marker("mvp"), signature: null });
check("signature: null PASS blocks", blocks(r, "the gate result is not signed"), show(r));
r = guard({ ...signed(marker("mvp")), grade: "A" });
check("tampered grade blocks", blocks(r, "does not verify"), show(r));
r = guard({ ...signed({ ...marker("mvp"), verdict: "FAIL" }), verdict: "PASS" });
check("verdict edited from FAIL to PASS blocks", blocks(r, "does not verify"), show(r));
{
  const { arch_sha256: _dropped, ...stripped } = signed(marker("mvp"));
  r = guard(stripped);
  check("nine-element marker with arch_sha256 removed blocks", blocks(r, "does not verify"), show(r));
}
r = guard(signed(marker("mvp"), other.privateKey));
check("foreign key blocks", blocks(r, "does not verify"), show(r));
r = guard({ ...signed(marker("mvp")), project: "other" });
check("project differs from the signed one blocks", blocks(r, "does not verify"), show(r));
r = guard(signed(marker("enterprise")));
check("scope enterprise blocks", blocks(r, "unknown scope 'enterprise'"), show(r));
r = guard({ ...signed(marker("mvp")), signature: "!!!not-base64!!!" });
check("malformed signature blocks", blocks(r, "signature is malformed"), show(r));

console.log("\n[BUG-09] the requested scaffold scope\n");
r = guard(signed(marker("mvp")), { args: ["production"] });
check("signed mvp, requested production blocks", blocks(r, "covers mvp only"), show(r));
r = guard(signed(marker("mvp")), { args: ["mvp"] });
check("signed mvp, requested mvp unlocks", unlocks(r, "mvp"), show(r));
r = guard(signed(marker("production")), { args: ["production"] });
check("signed production, requested production unlocks", unlocks(r, "production"), show(r));
r = guard(signed(marker("mvp")), { args: ["enterprise"] });
check("requested scope enterprise blocks", blocks(r, "unknown scaffold scope 'enterprise'"), show(r));

console.log("\n[BUG-09] the key set\n");
r = guard(signed(marker("mvp")), { guardPath: join(pluginRoot([]), "scripts", "guard.sh") });
check("empty keys/ blocks", blocks(r, "has no gate key"), show(r));
r = guard(signed(marker("mvp")), { guardPath: join(pluginRoot([other.publicKey, main.publicKey]), "scripts", "guard.sh") });
check("an unrelated key beside the right one still unlocks (grace set)", unlocks(r, "mvp"), show(r));

console.log("\n[BUG-09] the shipped guard and key\n");
check("the bundled key is the pinned live gate public key",
  existsSync(KEY) && readFileSync(KEY, "utf8").replace(/\r\n/g, "\n").trim() === PINNED);
// The shipped guard trusts only the real key, so a fixture-signed intake result blocks before the gate is read.
r = guard(marker("mvp"), { guardPath: GUARD });
check("shipped guard: a fixture-signed intake blocks before the unsigned gate is read",
  blocks(r, "intake result's receipt does not verify") && !r.err.includes("gate result"), show(r));
r = guard(signed(marker("mvp")), { guardPath: GUARD });
check("shipped guard and key: a fixture-signed intake blocks before the throwaway-signed gate is read",
  blocks(r, "intake result's receipt does not verify"), show(r));

console.log("\n[CR-210] I: scaffold verifies the signed intake receipt first\n");
const rerun = (r, text) => blocks(r, text) && r.err.includes("/devgenie:intake");
const GOOD_GATE = signed(marker("mvp"));
r = guard(GOOD_GATE, { intake: fx("pass") });
check("signed intake PASS and a good gate unlock", unlocks(r, "mvp"), show(r));
r = guard(GOOD_GATE, { intake: fx("conditional") });
check("signed intake CONDITIONAL and a good gate unlock", unlocks(r, "mvp"), show(r));
r = guard(GOOD_GATE, { intake: writer("conditional") });
check("served-writer CONDITIONAL marker and a good gate unlock", unlocks(r, "mvp"), show(r));
const badIntake = [
  ["signed HOLD", fx("hold"), "intake verdict is 'HOLD'"],
  ["signed FAIL", fx("fail"), "intake verdict is 'FAIL'"],
  ["an old PASS with no receipt", { gate: "intake", verdict: "PASS" }, "has no signed receipt"],
  ["a signed PASS with the receipt deleted", (() => { const m = fx("pass"); delete m.receipt; return m; })(), "has no signed receipt"],
  ["HOLD edited to PASS", { ...fx("hold"), verdict: "PASS" }, "receipt does not verify"],
  ["a receipt signed by another key", fx("pass-other-key"), "receipt does not verify"],
  ["no intake result", null, "no intake result"],
];
for (const [label, intake, text] of badIntake) {
  r = guard(GOOD_GATE, { intake });
  check(`${label} blocks scaffold even with a good gate`, rerun(r, text), show(r));
}
r = guard(marker("mvp"), { intake: fx("pass") });
check("a good intake receipt, then an unsigned gate, blocks on the gate", blocks(r, "the gate result is not signed"), show(r));
r = guard({ ...GOOD_GATE, grade: "A" }, { intake: fx("pass") });
check("a good intake receipt, then a tampered gate, blocks on the gate", blocks(r, "gate result's signature does not verify"), show(r));
r = guard(null, { intake: fx("pass") });
check("a good intake receipt and no gate result blocks on the gate", blocks(r, "no rating verdict"), show(r));

try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort scratch cleanup */ }
console.log(failures ? `\nGUARD-SCAFFOLD: FAIL (${failures} failed, ${passed} passed)` : `\nGUARD-SCAFFOLD: OK (${passed} passed)`);
process.exit(failures ? 1 : 0);
