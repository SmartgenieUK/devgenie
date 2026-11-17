#!/usr/bin/env node
// Project-local setup for /devgenie:cac. Run from the project root.
// The checker comes only from the handed kit; this installer contains no admission policy.
// Usage: node install.mjs --kit <dir> [--no-hook] | --undo | --check-paths <path>...
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(process.cwd());
const dg = join(project, ".devgenie");
const settingsPath = join(project, ".claude", "settings.json");
const RECORD = join(dg, "cac.install.json");
const CONFIG = join(dg, "cac.json");
const KIT = join(dg, "kit", "cac");
const INCOMING = join(dg, "kit-incoming", "cac");
const HANDLER = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.devgenie/cac-hook.mjs"], timeout: 10 };
const USAGE = "usage: node install.mjs --kit <dir> [--no-hook] | --undo | --check-paths <path>...";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rel = (path) => relative(project, path).split(sep).join("/");
const say = (text) => console.log(text);
const die = (text) => { console.error(text); process.exit(2); };
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hashOk = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const outside = (path) => path === ".." || path.startsWith(".." + sep) || isAbsolute(path);

/** Served paths use forward slashes and contain no empty, dot or parent segment. */
function pathOk(path) {
  if (typeof path !== "string" || path === "" || /[\\:]/.test(path) || [...path].some((ch) => ch.charCodeAt(0) < 32) || path.startsWith("/")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part));
}

function info(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeDestination(path, bytes) {
  const before = info(path);
  if (!before) {
    if (bytes !== undefined) writeFileSync(path, bytes, { flag: "wx" });
    return;
  }
  const check = (stat) => {
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) {
      throw new Error("Refusing a linked, non-regular or replaced file at " + rel(path) + "; nothing was written to it.");
    }
  };
  check(before);
  if (bytes === undefined) return;
  const fd = openSync(path, "r+");
  try {
    check(fstatSync(fd));
    writeFileSync(fd, bytes);
    ftruncateSync(fd, bytes.length);
  } finally { closeSync(fd); }
}

/** Check every existing destination component, including dangling links and junctions. */
function guardProjectPath(path, directory = false) {
  const absolute = resolve(path);
  const local = relative(project, absolute);
  if (outside(local)) die("Refusing a path outside the project: " + path);
  const base = realpathSync(project);
  let probe = project;
  const parts = local.split(sep).filter(Boolean);
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) probe = join(probe, parts[i]);
    const stat = info(probe);
    if (!stat) return;
    if (stat.isSymbolicLink() || outside(relative(base, realpathSync(probe)))) {
      die("Refusing a symbolic link or junction at " + rel(probe) + "; nothing was changed.");
    }
    const wantDirectory = i < parts.length - 1 || directory;
    if (wantDirectory ? !stat.isDirectory() : !stat.isFile()) {
      die("Unexpected file type at " + rel(probe) + "; nothing was changed.");
    }
  }
}

/** Kit sources must also be ordinary directories/files, with no linked ancestors. */
function guardSource(dir) {
  let probe = parse(dir).root;
  for (const part of relative(probe, dir).split(sep).filter(Boolean)) {
    probe = join(probe, part);
    const stat = info(probe);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) die("The kit folder is missing, linked or not a directory: " + dir);
  }
}

function walk(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const local = relative(base, path).split(sep).join("/");
    if (!pathOk(local)) die("Refusing the kit path " + JSON.stringify(local) + "; nothing was changed.");
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) die("Refusing a linked kit entry: " + local);
    if (stat.isDirectory()) files.push(...walk(path, base));
    else if (stat.isFile()) files.push({ path: local, bytes: readFileSync(path) });
    else die("Refusing a non-file kit entry: " + local);
  }
  return files;
}

function settingsObject(bytes) {
  let obj;
  try { obj = JSON.parse(bytes.toString("utf8")); } catch { die("The settings are not valid JSON; nothing was changed."); }
  const bad = () => die("The settings have an unexpected shape; nothing was changed.");
  if (!plain(obj)) bad();
  if ("hooks" in obj) {
    if (!plain(obj.hooks)) bad();
    if ("PreToolUse" in obj.hooks) {
      if (!Array.isArray(obj.hooks.PreToolUse)) bad();
      for (const group of obj.hooks.PreToolUse) {
        if (!plain(group) || !Array.isArray(group.hooks)) bad();
      }
    }
  }
  return obj;
}

function loadSettings() {
  guardProjectPath(settingsPath);
  if (!existsSync(settingsPath)) return { exists: false, bytes: null, obj: {} };
  const bytes = readFileSync(settingsPath);
  return { exists: true, bytes, obj: settingsObject(bytes) };
}

// A developer's changed timeout, type, arguments or extra handler fields are preserved.
const isHandler = (handler) => plain(handler) && Object.keys(handler).length === Object.keys(HANDLER).length
  && handler.type === HANDLER.type && handler.command === HANDLER.command && handler.timeout === HANDLER.timeout
  && JSON.stringify(handler.args) === JSON.stringify(HANDLER.args);
const hasHandler = (obj) => (obj.hooks?.PreToolUse ?? []).some((group) => group.matcher === "Bash" && group.hooks.some(isHandler));

/** Remove only the unchanged Bash handler, pruning only the containers it empties. */
function dropHandler(obj) {
  const pre = obj.hooks?.PreToolUse;
  if (!pre) return;
  obj.hooks.PreToolUse = pre.flatMap((group) => {
    if (group.matcher !== "Bash") return [group];
    const hooks = group.hooks.filter((handler) => !isHandler(handler));
    if (hooks.length === group.hooks.length) return [group];
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  if (obj.hooks.PreToolUse.length === 0) delete obj.hooks.PreToolUse;
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
}

const ownedFilePath = (path) => pathOk(path) && (
  path === ".devgenie/cac-check.mjs" || path === ".devgenie/cac-hook.mjs" || path.startsWith(".devgenie/kit/cac/")
);
const ownedDirectoryPath = (path) => pathOk(path) && (
  [".devgenie", ".devgenie/kit", ".devgenie/kit/cac", ".claude"].includes(path) || path.startsWith(".devgenie/kit/cac/")
);

function loadRecord() {
  const base = {
    config_created: false, config_sha: null, settings_created: false, hook_added: false,
    settings_original: null, settings_sha: null, files: {}, directories: [],
  };
  guardProjectPath(RECORD);
  if (!existsSync(RECORD)) return { ...base, exists: false };
  let record;
  try { record = JSON.parse(readFileSync(RECORD, "utf8")); } catch { die("The ownership manifest is not valid JSON; nothing was changed."); }
  const bad = () => die("The ownership manifest has an unsafe or unexpected shape; nothing was changed.");
  if (!plain(record)) bad();
  for (const key of ["config_created", "settings_created", "hook_added"]) if (typeof record[key] !== "boolean") bad();
  if (record.config_created ? !hashOk(record.config_sha) : record.config_sha !== null) bad();
  if (!plain(record.files) || !Array.isArray(record.directories)) bad();
  for (const [path, hash] of Object.entries(record.files)) if (!ownedFilePath(path) || !hashOk(hash)) bad();
  if (record.directories.some((path) => !ownedDirectoryPath(path)) || new Set(record.directories).size !== record.directories.length) bad();
  if (record.hook_added) {
    if (!hashOk(record.settings_sha)) bad();
    if (record.settings_created) {
      if (record.settings_original !== null) bad();
    } else {
      if (typeof record.settings_original !== "string") bad();
      const original = Buffer.from(record.settings_original, "base64");
      if (original.toString("base64") !== record.settings_original) bad();
      settingsObject(original);
    }
  } else if (record.settings_created || record.settings_original !== null || record.settings_sha !== null) bad();
  // Check even old outputs, so neither reinstall nor undo can follow a substituted link.
  for (const path of Object.keys(record.files)) guardProjectPath(join(project, path));
  for (const path of record.directories) guardProjectPath(join(project, path), true);
  return { ...base, ...record, exists: true };
}

const formatted = (obj) => Buffer.from(JSON.stringify(obj, null, 2) + "\n");
const temporary = (path) => path + ".tmp-" + process.pid;
function validateAtomic(path) {
  guardProjectPath(path);
  writeDestination(path);
  guardProjectPath(temporary(path));
  if (info(temporary(path))) die("A temporary file is in the way at " + rel(temporary(path)) + "; nothing was changed.");
}
function writeAtomic(path, bytes) {
  writeDestination(path);
  mkdirSync(dirname(path), { recursive: true });
  const temp = temporary(path);
  writeFileSync(temp, bytes, { flag: "wx" });
  try { renameSync(temp, path); } finally { if (existsSync(temp)) rmSync(temp); }
}

/** Decide settings changes before writing anything. Never restore over a later edit. */
function unwire(record, settings) {
  if (!record.hook_added || !settings.exists) return null;
  if (sha(settings.bytes) === record.settings_sha) {
    return record.settings_created
      ? { action: "remove" }
      : { action: "write", bytes: Buffer.from(record.settings_original, "base64") };
  }
  const before = JSON.stringify(settings.obj);
  dropHandler(settings.obj);
  if (record.settings_created && Object.keys(settings.obj).length === 0) return { action: "remove" };
  if (JSON.stringify(settings.obj) === before) return null;
  return { action: "write", bytes: formatted(settings.obj) };
}

function applySettings(change) {
  if (!change) return;
  if (change.action === "remove") { rmSync(settingsPath); say("removed " + rel(settingsPath)); }
  else { writeAtomic(settingsPath, change.bytes); say("updated " + rel(settingsPath)); }
}

function pruneOwned(directories) {
  for (const path of [...directories].sort((a, b) => b.split("/").length - a.split("/").length || b.localeCompare(a))) {
    const absolute = join(project, path);
    if (existsSync(absolute) && readdirSync(absolute).length === 0) rmdirSync(absolute);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--check-paths") {
    if (argv.length < 2) die(USAGE);
    const bad = argv.slice(1).find((path) => !pathOk(path) || path.startsWith("--"));
    if (bad !== undefined) die("Refusing the path " + JSON.stringify(bad) + ": use a relative path with forward slashes and no dot or parent segment.");
    guardProjectPath(INCOMING, true);
    for (const path of argv.slice(1)) {
      const destination = join(INCOMING, path);
      guardProjectPath(destination);
      const stat = info(destination);
      if (stat && (!stat.isFile() || stat.nlink !== 1)) die("Refusing a linked or non-regular staging file at " + rel(destination) + "; nothing was written.");
    }
    return;
  }
  const opts = { noHook: false, undo: false, kit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--kit" && opts.kit === null && i + 1 < argv.length && argv[i + 1] !== "" && !argv[i + 1].startsWith("--")) opts.kit = argv[++i];
    else if (arg === "--no-hook" && !opts.noHook) opts.noHook = true;
    else if (arg === "--undo" && !opts.undo) opts.undo = true;
    else die(USAGE);
  }
  if (opts.undo ? argv.length !== 1 : opts.kit === null) die(USAGE);

  const record = loadRecord();
  if (opts.undo && !record.exists) { say("Ownership manifest absent; nothing to remove."); return; }
  guardProjectPath(CONFIG);
  const settings = loadSettings();

  if (opts.undo) {
    const settingsChange = unwire(record, settings);
    if (settingsChange?.action === "write") validateAtomic(settingsPath);
    const removals = [];
    for (const [path, hash] of Object.entries(record.files)) {
      const absolute = join(project, path);
      if (!existsSync(absolute)) say("absent " + path);
      else if (sha(readFileSync(absolute)) === hash) removals.push(absolute);
      else say("kept (changed since install) " + path);
    }
    if (record.config_created && existsSync(CONFIG)) {
      if (sha(readFileSync(CONFIG)) === record.config_sha) removals.push(CONFIG);
      else say("kept (changed since install) " + rel(CONFIG));
    }
    // All inputs and removal targets have been checked before the first change.
    applySettings(settingsChange);
    for (const path of removals) { rmSync(path); say("removed " + rel(path)); }
    rmSync(RECORD);
    pruneOwned(record.directories);
    say("Undone. The journal (.devgenie/admissions.jsonl) and developer edits are kept.");
    return;
  }

  const kitDir = resolve(project, opts.kit);
  guardSource(kitDir);
  const staged = walk(kitDir);
  const checker = staged.find((file) => file.path === "files/cac-check.mjs");
  if (!checker) die("The handed kit has no files/cac-check.mjs; nothing was changed.");
  const hookBytes = readFileSync(join(here, "cac-hook.mjs"));
  const decisions = [];

  /** Only absent or owned, unedited outputs may be written. Identical foreign files stay foreign. */
  function decide(absolute, bytes, kind) {
    guardProjectPath(absolute);
    const path = rel(absolute);
    if (!existsSync(absolute)) { decisions.push({ absolute, path, bytes, action: "created" }); return; }
    const current = sha(readFileSync(absolute));
    if (current === sha(bytes)) { decisions.push({ absolute, path, bytes, action: "unchanged" }); return; }
    if (record.files[path] === current) {
      writeDestination(absolute);
      decisions.push({ absolute, path, bytes, action: "updated" });
      return;
    }
    const why = record.files[path] ? "changed since install" : "not installed by DevGenie";
    if (kind !== "kit") die("A different file is in the way at " + path + " (" + why + "); nothing was changed.");
    decisions.push({ absolute, path, bytes, action: "kept (" + why + ")" });
  }
  decide(join(dg, "cac-check.mjs"), checker.bytes, "checker");
  decide(join(dg, "cac-hook.mjs"), hookBytes, "hook");
  for (const file of staged) decide(join(KIT, ...file.path.split("/")), file.bytes, "kit");

  // A staged path cannot be both an output file and another output's parent directory.
  const outputs = new Set(decisions.map((decision) => decision.absolute));
  for (const decision of decisions) {
    let parent = dirname(decision.absolute);
    while (parent !== project) {
      if (outputs.has(parent)) die("Conflicting kit file paths; nothing was changed.");
      parent = dirname(parent);
    }
  }

  const next = {
    config_created: record.config_created, config_sha: record.config_sha,
    settings_created: record.settings_created, hook_added: record.hook_added,
    settings_original: record.settings_original, settings_sha: record.settings_sha,
    files: { ...record.files }, directories: [...record.directories],
  };
  const configBytes = existsSync(CONFIG) ? null : formatted({ enforce: true });
  if (configBytes !== null) { next.config_created = true; next.config_sha = sha(configBytes); }

  const wantHook = !opts.noHook;
  let settingsChange = null;
  if (wantHook) {
    const obj = settings.obj;
    if (hasHandler(obj)) say("unchanged " + rel(settingsPath) + " (the hook entry is already there)");
    else {
      // Capture the current bytes only when adding an entry; a reinstall must not refresh a stale snapshot.
      next.settings_created = !settings.exists;
      next.settings_original = settings.exists ? settings.bytes.toString("base64") : null;
      obj.hooks = obj.hooks ?? {};
      obj.hooks.PreToolUse = obj.hooks.PreToolUse ?? [];
      obj.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ ...HANDLER }] });
      settingsChange = { action: "write", bytes: formatted(obj) };
      next.settings_sha = sha(settingsChange.bytes);
      next.hook_added = true;
    }
  } else {
    settingsChange = unwire(record, settings);
    next.hook_added = false;
    next.settings_created = false;
    next.settings_original = null;
    next.settings_sha = null;
  }

  if (settingsChange?.action === "write") validateAtomic(settingsPath);
  validateAtomic(RECORD);
  // Only this exact validated incoming cac tree may be cleaned after a successful install.
  const cleanIncoming = kitDir === INCOMING;
  if (cleanIncoming) guardProjectPath(INCOMING, true);

  const directories = new Set(next.directories);
  function rememberParents(path) {
    let parent = dirname(path);
    while (parent !== project) {
      if (!existsSync(parent)) directories.add(rel(parent));
      parent = dirname(parent);
    }
  }
  for (const decision of decisions) {
    if (decision.action === "created" || decision.action === "updated") rememberParents(decision.absolute);
  }
  if (configBytes !== null) rememberParents(CONFIG);
  if (settingsChange?.action === "write") rememberParents(settingsPath);
  rememberParents(RECORD);
  next.directories = [...directories].sort();

  // Apply only after argument, settings, manifest, source and destination validation.
  try {
    const { recordProject } = await import(new URL("../../uninstall/scripts/projects.mjs", import.meta.url));
    await recordProject(project);
  } catch {}
  for (const decision of decisions) {
    if (decision.action === "created" || decision.action === "updated") {
      mkdirSync(dirname(decision.absolute), { recursive: true });
      writeDestination(decision.absolute, decision.bytes);
      next.files[decision.path] = sha(decision.bytes);
    }
    say(decision.action + " " + decision.path);
  }
  if (configBytes !== null) {
    mkdirSync(dg, { recursive: true });
    writeDestination(CONFIG, configBytes);
    say("created " + rel(CONFIG));
  } else say("unchanged " + rel(CONFIG));
  applySettings(settingsChange);
  if (!wantHook && next.directories.includes(".claude") && existsSync(dirname(settingsPath)) && readdirSync(dirname(settingsPath)).length === 0) {
    rmdirSync(dirname(settingsPath));
    next.directories = next.directories.filter((path) => path !== ".claude");
  }
  writeAtomic(RECORD, formatted(next));
  if (cleanIncoming) rmSync(INCOMING, { recursive: true });

  say('Run the check with: node .devgenie/cac-check.mjs --message "<text>"');
  if (wantHook) say("The hook governs only Claude's Bash commits in this project; terminal and IDE commits are outside its scope. It takes effect in a new Claude Code session.");
  else say("Bash wiring is off. Both local scripts are installed; any hook change takes effect in a new Claude Code session.");
  say('Switch enforcement off with DEVGENIE_CAC=off or "enforce": false in .devgenie/cac.json, or run install.mjs --undo.');
}

try { await main(); } catch (error) { die("Setup could not finish: " + error.message); }
