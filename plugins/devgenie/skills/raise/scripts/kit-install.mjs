#!/usr/bin/env node
// kit-install.mjs - plumbing for a DevGenie starter-kit practice. It only does what it is handed:
//   install <kit.json>                 write the kit's files, as given, under .devgenie/kit/ (and nowhere else)
//   guard-on  [--script <path>]        opt in: run the installed script as a Claude Code PreToolUse hook in this project
//   guard-off [--script <path>]        undo guard-on
// Run it from the project root. Node 18 or later, no dependencies, the same on Windows, macOS and Linux.
// Exit codes: 0 done, 1 refused (nothing changed), 2 used wrongly.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, isAbsolute, sep } from "node:path";

const KIT_ROOT = ".devgenie/kit/";
const DEFAULT_SCRIPT = ".devgenie/kit/raise/records.mjs";
const SETTINGS = ".claude/settings.json";
const MATCHER = "Write|Edit|MultiEdit";
const TIMEOUT_SECONDS = 10;

/** True for a relative, forward-slash path under .devgenie/kit/ with no .. or empty part and no drive letter. */
function safeKitPath(p) {
  if (typeof p !== "string" || !p.startsWith(KIT_ROOT) || p.length === KIT_ROOT.length) return false;
  if (p.includes("\\") || /^[A-Za-z]:/.test(p) || p.startsWith("/")) return false;
  return p.split("/").every((part) => part !== "" && part !== ".." && part !== ".");
}

/** Refuse links (including junctions and dangling links) at every existing component, even links within the project. */
function unsafeProjectPath(p) {
  const outside = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  try {
    const project = resolve(".");
    const base = realpathSync(project);
    const rel = relative(project, resolve(p));
    if (outside(rel)) return true;
    let probe = project;
    for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
      if (part) probe = resolve(probe, part);
      let info;
      try { info = lstatSync(probe); } catch (e) {
        if (e.code === "ENOENT") return false; // remaining components will be created below this checked parent
        throw e;
      }
      if (info.isSymbolicLink() || outside(relative(base, realpathSync(probe)))) return true;
    }
    return false;
  } catch { return true; } // an uncheckable destination is refused before any write
}

const escapesKitRoot = (p) => unsafeProjectPath(KIT_ROOT) || unsafeProjectPath(p);
const refusePath = (p) => {
  console.error(`refused: ${p} is a symbolic link or junction, resolves outside the project directory, or cannot be checked; nothing was written`);
  return 1;
};

function install(file) {
  let kit;
  try { kit = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`cannot read ${file} as JSON: ${e.message}`); return 2; }
  const files = Array.isArray(kit?.files) ? kit.files : [];
  if (files.length === 0) { console.error("the kit holds no files; nothing was written"); return 1; }
  const bad = files.find((f) => !safeKitPath(f?.path) || typeof f?.body !== "string");
  if (bad) { console.error(`refused: the path ${JSON.stringify(bad?.path)} is not a file under ${KIT_ROOT}; nothing was written`); return 1; }
  const linked = files.find((f) => escapesKitRoot(f.path));
  if (linked) return refusePath(linked.path);
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.body.replace(/\r\n/g, "\n"));
    console.log(`wrote ${f.path}`);
  }
  console.log(`to undo: delete ${KIT_ROOT}`);
  return 0;
}

const hookCommand = (script) => `node "$CLAUDE_PROJECT_DIR/${script}" hook`;
const isOurs = (h, script) => h?.command === hookCommand(script);
function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  try {
    const s = JSON.parse(readFileSync(SETTINGS, "utf8"));
    return s !== null && typeof s === "object" && !Array.isArray(s) ? s : null;
  } catch { return null; }
}
const saveSettings = (s) => { mkdirSync(dirname(SETTINGS), { recursive: true }); writeFileSync(SETTINGS, `${JSON.stringify(s, null, 2)}\n`); };

function guardOn(script) {
  if (!safeKitPath(script) || !existsSync(resolve(script))) { console.error(`${script} is not installed, so nothing was changed. Run install first.`); return 1; }
  if (escapesKitRoot(script)) return refusePath(script);
  if (unsafeProjectPath(SETTINGS)) return refusePath(SETTINGS);
  const s = readSettings();
  if (s === null) { console.error(`${SETTINGS} is not valid JSON, so nothing was changed. Fix it, then run guard-on again.`); return 1; }
  s.hooks ??= {};
  s.hooks.PreToolUse ??= [];
  if (s.hooks.PreToolUse.some((e) => (e?.hooks ?? []).some((h) => isOurs(h, script)))) {
    console.log(`The guard was already on in ${SETTINGS}; nothing changed.`);
    return 0;
  }
  const entry = { matcher: MATCHER, hooks: [{ type: "command", command: hookCommand(script), timeout: TIMEOUT_SECONDS }] };
  s.hooks.PreToolUse.push(entry);
  saveSettings(s);
  console.log(`Added one PreToolUse hook to ${SETTINGS} (matcher ${MATCHER}); every other setting is kept.`);
  console.log("It starts in a fresh Claude Code session. To undo: run guard-off.");
  return 0;
}

function guardOff(script) {
  if (!safeKitPath(script) || escapesKitRoot(script)) return refusePath(script);
  if (unsafeProjectPath(SETTINGS)) return refusePath(SETTINGS);
  const s = readSettings();
  if (s === null) { console.error(`${SETTINGS} is not valid JSON, so nothing was changed.`); return 1; }
  const list = s.hooks?.PreToolUse;
  let removed = 0;
  if (Array.isArray(list)) {
    const kept = [];
    for (const e of list) {
      const hooks = e?.hooks ?? [];
      const rest = hooks.filter((h) => !isOurs(h, script));
      removed += hooks.length - rest.length;
      if (rest.length === hooks.length) kept.push(e);
      else if (rest.length > 0) kept.push({ ...e, hooks: rest });
    }
    if (removed > 0) {
      if (kept.length > 0) s.hooks.PreToolUse = kept; else delete s.hooks.PreToolUse;
      if (Object.keys(s.hooks).length === 0) delete s.hooks;
      saveSettings(s);
    }
  }
  console.log(removed > 0 ? `Removed the guard from ${SETTINGS}; every other setting is kept.` : "The guard was not on; nothing to remove.");
  return 0;
}

const [cmd, ...args] = process.argv.slice(2);
const at = args.indexOf("--script");
const script = at >= 0 && args[at + 1] ? args[at + 1] : DEFAULT_SCRIPT;
let code = 2;
if (cmd === "install" && args[0]) code = install(args[0]);
else if (cmd === "guard-on") code = guardOn(script);
else if (cmd === "guard-off") code = guardOff(script);
else console.error("usage: kit-install.mjs install <kit.json> | guard-on [--script <path>] | guard-off [--script <path>]");
process.exitCode = code;
