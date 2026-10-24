// test/guard-scaffold.mjs — BUG-09: the public scaffold guard verifies DevGenie's gate signature.
//
// Runs the packaged entrypoint, `bash scripts/guard.sh scaffold [scope]`, from a temporary project holding
// .devgenie/gate.json. Markers are signed here exactly as the server signs them (canonicalGate: a fixed-order
// JSON array, nine elements with arch_sha256, eight on a pre-v1.9 marker; ES256 DER signature, base64) with
// throwaway P-256 key pairs. The guard is copied into a temporary plugin root whose keys/ holds the throwaway
// public key; two cases run the real plugins/devgenie/scripts/guard.sh against the real bundled key.
// No network, no node_modules, no real private key. Needs bash, jq, openssl and base64 on PATH.
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

// A temporary plugin root: scripts/guard.sh copied from the package, keys/ holding the given public keys.
let n = 0;
function pluginRoot(keys) {
  const root = join(work, `plugin${n++}`);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "keys"), { recursive: true });
  copyFileSync(GUARD, join(root, "scripts", "guard.sh"));
  keys.forEach((k, i) => writeFileSync(join(root, "keys", `k${i}.pem`), pem(k)));
  return root;
}
const root = pluginRoot([main.publicKey]);

function guard(m, { args = [], guardPath = join(root, "scripts", "guard.sh") } = {}) {
  const proj = join(work, `proj${n++}`);
  mkdirSync(join(proj, ".devgenie"), { recursive: true });
  writeFileSync(join(proj, ".devgenie", "gate.json"), JSON.stringify(m, null, 2));
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
r = guard(marker("mvp"), { guardPath: GUARD });
check("shipped guard: unsigned PASS blocks", blocks(r, "the gate result is not signed"), show(r));
r = guard(signed(marker("mvp")), { guardPath: GUARD });
check("shipped guard and key: a throwaway-signed PASS does not verify", blocks(r, "does not verify"), show(r));

try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort scratch cleanup */ }
console.log(failures ? `\nGUARD-SCAFFOLD: FAIL (${failures} failed, ${passed} passed)` : `\nGUARD-SCAFFOLD: OK (${passed} passed)`);
process.exit(failures ? 1 : 0);
