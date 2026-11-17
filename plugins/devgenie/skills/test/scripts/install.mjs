#!/usr/bin/env node
// install.mjs - per-project, opt-in, idempotent setup for the /devgenie:test skill. Run from the project root.
//
//   node install.mjs [--command "<test command>"] [--no-hook] [--kit <staged folder>]
//   node install.mjs --undo
//   node install.mjs --check-paths <path>...
//
// It writes only under <project>/.devgenie/ and, for the commit hook, the one entry in <project>/.claude/settings.json.
// It copies the test gate and the commit hook into the project, writes the kit files it is handed (it reads them, never
// interprets them), and records what it wrote in .devgenie/test-gate.install.json so that --undo removes exactly that and
// nothing the developer owns or has edited. Run with no flag again at any time: it is idempotent.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = process.cwd();
const dg = join(project, ".devgenie");
const settingsPath = join(project, ".claude", "settings.json");
const RECORD = join(dg, "test-gate.install.json");
const CONFIG = join(dg, "test-gate.json");
const HANDLER = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.devgenie/test-gate-hook.mjs"], timeout: 600 };
const USAGE = 'usage: node install.mjs [--command "<test command>"] [--no-hook] [--kit <staged folder>] | --undo | --check-paths <path>...';

const sha = (b) => createHash("sha256").update(b).digest("hex");
const rel = (p) => relative(project, p).split("\\").join("/");
const say = (m) => console.log(m);
const die = (m) => { console.error(m); process.exit(2); };
const isHandler = (h) => h && typeof h === "object" && h.command === HANDLER.command && JSON.stringify(h.args) === JSON.stringify(HANDLER.args);
const plain = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

/** A path a served file may have: relative, forward slashes, no empty or .. segment. */
function pathOk(p) {
  if (typeof p !== "string" || p === "" || p.includes("\\") || /^([A-Za-z]:|\/)/.test(p)) return false;
  return !p.split("/").some((s) => s === "" || s === "..");
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base)); else out.push(relative(base, p).split("\\").join("/"));
  }
  return out.sort();
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function loadRecord() {
  const base = { config_created: false, config_sha: null, settings_created: false, hook_added: false, files: {} };
  if (!existsSync(RECORD)) return { ...base, exists: false };
  try { return { ...base, ...JSON.parse(readFileSync(RECORD, "utf8")), exists: true }; } catch { return die(`${rel(RECORD)} is not valid JSON; repair or delete it, then run this again.`); }
}

/** The settings file as { obj, exists }, refusing (exit 2, nothing written) anything whose shape we cannot edit safely. */
function loadSettings() {
  if (!existsSync(settingsPath)) return { exists: false, obj: {} };
  let obj;
  try { obj = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { return die(`${rel(settingsPath)} is not valid JSON, so the commit hook was not touched and nothing was changed. Repair the file and run this again.`); }
  const bad = (what) => die(`${rel(settingsPath)} has an unexpected shape (${what}), so the commit hook was not touched and nothing was changed.`);
  if (!plain(obj)) bad("the top level is not an object");
  if ("hooks" in obj) {
    if (!plain(obj.hooks)) bad("hooks is not an object");
    if ("PreToolUse" in obj.hooks) {
      if (!Array.isArray(obj.hooks.PreToolUse)) bad("hooks.PreToolUse is not a list");
      for (const g of obj.hooks.PreToolUse) if (!plain(g) || !Array.isArray(g.hooks)) bad("a PreToolUse entry has no hooks list");
    }
  }
  return { exists: true, obj };
}

const hasHandler = (obj) => (obj.hooks?.PreToolUse ?? []).some((g) => g.hooks.some(isHandler));

/** Removes our handler everywhere, pruning only what that empties. */
function dropHandler(obj) {
  const pre = obj.hooks?.PreToolUse;
  if (!pre) return;
  obj.hooks.PreToolUse = pre.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isHandler(h)) })).filter((g, i) => g.hooks.length > 0 || pre[i].hooks.length === 0);
  if (obj.hooks.PreToolUse.length === 0) delete obj.hooks.PreToolUse;
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
}

function fromPackageJson() {
  try {
    const t = JSON.parse(readFileSync(join(project, "package.json"), "utf8"))?.scripts?.test;
    if (typeof t === "string" && t.trim() !== "" && !t.trim().startsWith('echo "Error: no test specified"')) return "npm test";
  } catch { /* no package.json, or not valid */ }
  return null;
}

function pruneEmpty(dir, stopAt) {
  let d = dir;
  while (d.startsWith(stopAt) && d !== stopAt && existsSync(d) && readdirSync(d).length === 0) { rmdirSync(d); d = dirname(d); }
}

function removeOwned(record, relPath, abs) {
  if (!existsSync(abs)) { say(`absent ${relPath}`); return; }
  if (sha(readFileSync(abs)) === record.files[relPath]) { rmSync(abs); say(`removed ${relPath}`); } else say(`kept (changed since install) ${relPath}`);
}

// ---- argument parsing -------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { command: null, noHook: false, undo: false, kit: null };
if (argv[0] === "--check-paths") {
  const bad = argv.slice(1).find((p) => !pathOk(p));
  if (bad !== undefined) die(`Refusing the path ${JSON.stringify(bad)}: a served file must have a relative path with forward slashes and no .. segment.`);
  process.exit(0);
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--command" && i + 1 < argv.length) opts.command = argv[++i];
  else if (a === "--kit" && i + 1 < argv.length) opts.kit = argv[++i];
  else if (a === "--no-hook") opts.noHook = true;
  else if (a === "--undo") opts.undo = true;
  else die(USAGE);
}
if (opts.command !== null && opts.command.trim() === "") die(USAGE);

// ---- undo -------------------------------------------------------------------------------------------------------------------
if (opts.undo) {
  const record = loadRecord();
  if (!record.exists) { say(`absent ${rel(RECORD)} (nothing to remove)`); process.exit(0); }
  const settings = record.hook_added ? loadSettings() : null; // validated before anything is changed
  if (record.hook_added && settings.exists) {
    dropHandler(settings.obj);
    if (record.settings_created && Object.keys(settings.obj).length === 0) { rmSync(settingsPath); say(`removed ${rel(settingsPath)}`); pruneEmpty(dirname(settingsPath), project); } else { writeAtomic(settingsPath, `${JSON.stringify(settings.obj, null, 2)}\n`); say(`updated ${rel(settingsPath)} (our hook entry removed)`); }
  }
  for (const r of Object.keys(record.files)) removeOwned(record, r, join(project, r));
  if (record.config_created) {
    if (!existsSync(CONFIG)) say(`absent ${rel(CONFIG)}`);
    else if (sha(readFileSync(CONFIG)) === record.config_sha) { rmSync(CONFIG); say(`removed ${rel(CONFIG)}`); } else say(`kept (changed since install) ${rel(CONFIG)}`);
  }
  rmSync(RECORD);
  say(`removed ${rel(RECORD)}`);
  pruneEmpty(join(dg, "kit", "test"), dg);
  pruneEmpty(join(dg, "kit"), dg);
  say("Undone. The reports (.devgenie/test-runs.jsonl and test-receipt.json) are kept.");
  process.exit(0);
}

// ---- install: validate everything first, then write -------------------------------------------------------------------------
const record = loadRecord();
let cfg = null;
let cfgText = null;
if (existsSync(CONFIG)) { cfgText = readFileSync(CONFIG, "utf8"); try { cfg = JSON.parse(cfgText); } catch { cfg = null; } }
const existingCmd = plain(cfg) && typeof cfg.command === "string" && cfg.command.trim() !== "" ? cfg.command : null;
const command = opts.command ?? existingCmd ?? fromPackageJson();
if (command === null) die('I could not find your test command. Run this again with --command "<the command that runs your tests>", for example --command "npm test".');

const wantHook = !opts.noHook;
const settings = wantHook || record.hook_added ? loadSettings() : null;

let staged = [];
if (opts.kit !== null) {
  const dir = resolve(project, opts.kit);
  if (!existsSync(dir)) die(`The kit folder ${opts.kit} does not exist.`);
  for (const p of walk(dir)) {
    if (!pathOk(p)) die(`Refusing the kit path ${JSON.stringify(p)}; nothing was written.`);
    staged.push({ path: p, bytes: readFileSync(join(dir, p)) });
  }
}

const shipped = (name) => readFileSync(join(here, name));
const decisions = [];
/** Ownership rule: write a file only when it is absent, or is ours and unedited; otherwise leave it. */
function decide(abs, bytes, kind) {
  const r = rel(abs);
  if (!existsSync(abs)) { decisions.push({ abs, r, bytes, action: "created" }); return; }
  const cur = sha(readFileSync(abs));
  if (cur === sha(bytes)) { decisions.push({ abs, r, bytes, action: "unchanged" }); return; }
  if (record.files[r] === cur) { decisions.push({ abs, r, bytes, action: "updated" }); return; }
  const why = record.files[r] ? "changed since install" : "not installed by DevGenie";
  if (kind !== "kit") die(`A different file is in the way at ${r} (${why}), so nothing was changed. Move it aside or run --undo, then run this again.`);
  decisions.push({ abs, r, bytes, action: `kept (${why})` });
}
decide(join(dg, "test-gate.mjs"), shipped("test-gate.mjs"), "runner");
if (wantHook) decide(join(dg, "test-gate-hook.mjs"), shipped("test-gate-hook.mjs"), "hook");
for (const s of staged) decide(join(dg, "kit", "test", ...s.path.split("/")), s.bytes, "kit");

// ---- apply ------------------------------------------------------------------------------------------------------------------
try {
  const { recordProject } = await import(new URL("../../uninstall/scripts/projects.mjs", import.meta.url));
  await recordProject(project);
} catch {}
const files = { ...record.files };
for (const d of decisions) {
  if (d.action === "created" || d.action === "updated") { mkdirSync(dirname(d.abs), { recursive: true }); writeFileSync(d.abs, d.bytes); files[d.r] = sha(d.bytes); }
  say(`${d.action} ${d.r}`);
}

let configCreated = record.config_created;
let configSha = record.config_sha;
if (cfgText === null) {
  const text = `${JSON.stringify({ command }, null, 2)}\n`;
  mkdirSync(dg, { recursive: true });
  writeFileSync(CONFIG, text);
  configCreated = true;
  configSha = sha(text);
  say(`created ${rel(CONFIG)}`);
} else if (command !== existingCmd) {
  const text = `${JSON.stringify({ ...(plain(cfg) ? cfg : {}), command }, null, 2)}\n`;
  const ours = record.config_created && record.config_sha === sha(cfgText);
  writeFileSync(CONFIG, text);
  configCreated = ours;
  configSha = ours ? sha(text) : null;
  say(`updated ${rel(CONFIG)}`);
} else say(`unchanged ${rel(CONFIG)}`);

let hookAdded = record.hook_added;
let settingsCreated = record.settings_created;
if (wantHook) {
  const obj = settings.obj;
  if (hasHandler(obj)) say(`unchanged ${rel(settingsPath)} (the hook entry is already there)`);
  else {
    obj.hooks = obj.hooks ?? {};
    obj.hooks.PreToolUse = obj.hooks.PreToolUse ?? [];
    obj.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ ...HANDLER }] });
    writeAtomic(settingsPath, `${JSON.stringify(obj, null, 2)}\n`);
    hookAdded = true;
    if (!settings.exists) settingsCreated = true;
    say(`${settings.exists ? "updated" : "created"} ${rel(settingsPath)}`);
  }
} else if (record.hook_added && settings?.exists) {
  dropHandler(settings.obj);
  if (settingsCreated && Object.keys(settings.obj).length === 0) { rmSync(settingsPath); pruneEmpty(dirname(settingsPath), project); settingsCreated = false; } else writeAtomic(settingsPath, `${JSON.stringify(settings.obj, null, 2)}\n`);
  const hs = join(dg, "test-gate-hook.mjs");
  if (existsSync(hs) && sha(readFileSync(hs)) === files[rel(hs)]) { rmSync(hs); delete files[rel(hs)]; say(`removed ${rel(hs)}`); }
  hookAdded = false;
  say(`removed the hook entry from ${rel(settingsPath)}`);
}

writeFileSync(RECORD, `${JSON.stringify({ config_created: configCreated, config_sha: configSha, settings_created: settingsCreated, hook_added: hookAdded, files }, null, 2)}\n`);

if (opts.kit !== null) {
  const dir = resolve(project, opts.kit);
  const incoming = join(dg, "kit-incoming");
  if (dir.startsWith(incoming + sep)) { rmSync(dir, { recursive: true, force: true }); if (existsSync(incoming) && readdirSync(incoming).length === 0) rmdirSync(incoming); }
}

say(`Run the gate with: node .devgenie/test-gate.mjs`);
if (wantHook) say("The commit hook blocks Claude's git commits while the test gate is red. It takes effect only in a new Claude Code session: start one, ask Claude to commit with a failing test, and expect the block. Switch it off with DEVGENIE_TEST_GATE=off or \"enforce\": false in .devgenie/test-gate.json, or run install.mjs --undo.");
