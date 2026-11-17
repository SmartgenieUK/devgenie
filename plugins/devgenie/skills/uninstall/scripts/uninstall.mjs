#!/usr/bin/env node
// Offline project cleanup, composing the installed practices' existing undo paths.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { CREATED_PATHS, info, protectedPath, readProjects } from "./projects.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS = ".claude/settings.json";
const STAGED = [
  ".devgenie/kit/task/claude-block.md",
  ".devgenie/kit-incoming/test/files/TESTING.md",
  ".devgenie/kit-incoming/cac/files/ADMISSION.md",
  ".devgenie/kit-incoming/cac/files/cac-check.mjs",
];
const LEFTOVERS = ["task-pointer.off", "sessions.off", "tasks.jsonl", "closes.jsonl", "compactor.jsonl", "briefs.jsonl", "sessions.jsonl", "test-runs.jsonl", "test-receipt.json", "admissions.jsonl", "step-ledger.jsonl"].map((p) => ".devgenie/" + p);
const FIXED_DIRS = [".devgenie/kit/task", ".devgenie/kit/raise", ".devgenie/kit/cac", ".devgenie/kit/test", ".devgenie/kit", ".devgenie/kit-incoming", ".devgenie/sessions"];
const BUILT = ["state.json", "config.json", "intake.json", "gate.json", "profile.json", "design.json", "gate-ledger.jsonl"].map((p) => ".devgenie/" + p)
  .concat([".claude/statusline.mjs", ".claude/hooks/record-tokens.sh"]);
const PRACTICES = [
  ["task", ".devgenie/task-pointer.json", "../../task/scripts/task.mjs"],
  ["test", ".devgenie/test-gate.install.json", "../../test/scripts/install.mjs"],
  ["cac", ".devgenie/cac.install.json", "../../cac/scripts/install.mjs"],
  ["sessions", ".devgenie/sessions.install.json", "../../sessions/scripts/sessions.mjs"],
  ["raise", ".devgenie/kit-raise.json", "../../raise/scripts/kit-install.mjs"],
  ["coarch", ".devgenie/kit/coarch.json", "../../coarch/scripts/briefs.mjs"],
];
const plain = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const formatted = (o) => Buffer.from(JSON.stringify(o, null, 2) + "\n");
const outside = (p) => isAbsolute(p) || p === ".." || p.startsWith(".." + sep);
const local = (root, p) => relative(root, p).split(sep).join("/");
const depth = (p) => p.split("/").length;
const deepest = (a, b) => depth(b) - depth(a) || b.localeCompare(a);
const say = (s) => console.log(s);
const refuse = (message) => { throw new Error(message); };
const display = (s) => String(s).replace(/[\r\n\t]/g, " ");
const realKey = (path) => { const real = realpathSync(path); return process.platform === "win32" ? real.toLowerCase() : real; };
function homeDevGenie(p, name) {
  if (name !== ".devgenie") return false;
  if (realKey(p.root) === realKey(homedir())) return true;
  const target = join(p.root, name), home = join(homedir(), name);
  return !!info(target) && !!info(home) && realKey(target) === realKey(home);
}
function safeRelative(p) {
  return typeof p === "string" && p !== "" && ![...p].some((c) => c === "\\" || c === ":" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && !p.startsWith("/") &&
    p.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part));
}
function validPath(p) {
  if (!safeRelative(p)) refuse("An install record names an unsafe project path.");
  return p;
}
function jsonAt(p, name) {
  try { return JSON.parse(readFileSync(join(p.root, name), "utf8")); }
  catch { refuse("Cannot read the saved record at " + name + "."); }
}
function readRecords(p) {
  const records = {}, names = new Map();
  const add = (name, directory = false) => { validPath(name); names.set(name, directory); };
  for (const name of [SETTINGS, "CLAUDE.md", ...LEFTOVERS, ...STAGED, ...BUILT, "metrics/token-ledger.jsonl"]) add(name);
  for (const name of [".devgenie", ".claude", ".claude/hooks", ...FIXED_DIRS]) add(name, true);
  add(".claude/settings.json.tmp-" + process.pid);
  add(".devgenie/cac.install.json.tmp-" + process.pid);
  add(".devgenie/briefs.jsonl.tmp");
  for (const name of p.entry?.created ?? []) { if (!CREATED_PATHS.includes(name)) refuse("Unsafe created path."); add(name, ![SETTINGS, "CLAUDE.md"].includes(name)); }
  const hashOk = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const booleans = (r, keys) => { if (keys.some((k) => typeof r[k] !== "boolean")) refuse("An install record has an unexpected flag."); };
  for (const [name, marker, script] of PRACTICES) {
    add(marker);
    if (!info(join(p.root, marker))) continue;
    const r = jsonAt(p, marker);
    if (!plain(r)) refuse("An install record is not an object.");
    if (name === "raise" || name === "coarch") {
      if (!Array.isArray(r.files) || !r.files.length) refuse("A saved kit has no checkable files list.");
      const seen = new Set();
      for (const f of r.files) {
        if (!plain(f) || typeof f.body !== "string") refuse("A saved kit has an uncheckable body.");
        add(f.path);
        if (seen.has(f.path) || (name === "raise" && !f.path.startsWith(".devgenie/kit/"))) refuse("A saved kit has an unsafe or duplicate path.");
        seen.add(f.path);
      }
    } else {
      if (!plain(r.files)) refuse("An install record has no checkable file hashes.");
      for (const [file, hash] of Object.entries(r.files)) {
        if (!hashOk(hash)) refuse("An install record has an invalid file hash.");
        if (name === "task") { validPath(file); add(".claude/hooks/" + file); }
        else add(file);
        if (name === "sessions" && !["statusline", "session-end", "step-log"].some((f) => file === ".devgenie/sessions/" + f + ".mjs")) refuse("Unexpected session output path.");
        if (name === "cac" && ![".devgenie/cac-check.mjs", ".devgenie/cac-hook.mjs"].includes(file) && !file.startsWith(".devgenie/kit/cac/")) refuse("Unexpected admission output path.");
      }
      if (name === "task") {
        booleans(r, ["block"]);
        if (!Array.isArray(r.settings) || r.settings.some((s) => !plain(s) || typeof s.event !== "string" || typeof s.command !== "string")) refuse("Unexpected task settings record.");
      } else if (name === "sessions") {
        booleans(r, ["hook_added", "statusline_added", "settings_created"]);
      } else {
        booleans(r, ["config_created", "settings_created", "hook_added"]);
        const config = ".devgenie/" + (name === "test" ? "test-gate" : "cac") + ".json";
        add(config);
        if (r.config_created && !hashOk(r.config_sha)) refuse("An install record has an invalid configuration hash.");
        if (name === "cac") {
          if (!Array.isArray(r.directories) || new Set(r.directories).size !== r.directories.length) refuse("Unexpected recorded directories.");
          for (const dir of r.directories) {
            add(dir, true);
            if (![".devgenie", ".devgenie/kit", ".devgenie/kit/cac", ".claude"].includes(dir) && !dir.startsWith(".devgenie/kit/cac/")) refuse("Unexpected recorded directory.");
          }
          if (r.config_created ? !hashOk(r.config_sha) : r.config_sha !== null) refuse("Unexpected configuration ownership.");
          if (r.hook_added) {
            if (!hashOk(r.settings_sha)) refuse("Invalid saved settings hash.");
            if (r.settings_created) { if (r.settings_original !== null) refuse("Unexpected saved settings."); }
            else {
              if (typeof r.settings_original !== "string") refuse("Missing original settings.");
              const bytes = Buffer.from(r.settings_original, "base64");
              if (bytes.toString("base64") !== r.settings_original) refuse("Invalid original settings.");
              try { validateSettings(JSON.parse(bytes.toString("utf8"))); }
              catch { refuse("Original settings cannot be checked."); }
            }
          } else if (r.settings_created || r.settings_original !== null || r.settings_sha !== null) refuse("Unexpected settings ownership.");
        }
      }
    }
    const sibling = fileURLToPath(new URL(script, import.meta.url));
    if (!info(sibling)?.isFile()) refuse("A required undo script is missing: " + script + ".");
    records[name] = r;
  }
  return { records, names };
}
function validateSettings(settings) {
  if (!plain(settings) || ("hooks" in settings && !plain(settings.hooks))) refuse("Project settings have an uncheckable shape.");
  for (const groups of Object.values(settings.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some((g) => !plain(g) || !Array.isArray(g.hooks) || g.hooks.some((h) => !plain(h)))) refuse("Project hooks have an uncheckable shape.");
  }
  return settings;
}
function checkPath(p, target, directory) {
  if (outside(relative(p.root, target))) refuse("A recorded path leaves the project.");
  let probe = p.root;
  const parts = relative(p.root, target).split(sep).filter(Boolean);
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) probe = join(probe, parts[i]);
    const stat = info(probe);
    if (!stat) return;
    if (stat.isSymbolicLink() || outside(relative(p.root, realpathSync(probe)))) refuse("A project path is a symbolic link, junction or outside the project: " + local(p.root, probe));
    if (i < parts.length - 1 || directory === true) {
      if (!stat.isDirectory()) refuse("A project directory cannot be checked: " + local(p.root, probe));
    } else if (directory === false && !stat.isFile()) refuse("A project file is not regular: " + local(p.root, probe));
    else if (!stat.isFile() && !stat.isDirectory()) refuse("An unsupported project entry was found.");
  }
}
function directoryParents(data) {
  const parents = new Set();
  for (const [name, directory] of data.names) {
    let parent = directory ? name : dirname(name).split(sep).join("/");
    while (parent !== ".") { parents.add(parent); parent = dirname(parent).split(sep).join("/"); }
  }
  return [...parents].sort();
}
function inventory(p, visit = () => {}, parents = []) {
  const nodes = new Map();
  function scan(name) {
    const absolute = join(p.root, name);
    if (protectedPath(absolute)) { nodes.set(name, { type: "protected" }); return; }
    visit(absolute);
    const stat = info(absolute);
    if (!stat) return;
    nodes.set(name, { type: stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file" });
    if (stat.isDirectory() && !stat.isSymbolicLink()) for (const child of readdirSync(absolute).sort()) scan(name + "/" + child);
  }
  for (const name of [".claude", ".devgenie"]) scan(name);
  // Outside the cleanup trees, inspect only named parents and their immediate entries.
  for (const name of parents) {
    if (name === ".claude" || name.startsWith(".claude/") || name === ".devgenie" || name.startsWith(".devgenie/")) continue;
    const absolute = join(p.root, name);
    visit(absolute);
    const stat = info(absolute);
    if (!stat) continue;
    nodes.set(name, { type: stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file" });
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const child of readdirSync(absolute).sort()) {
      const key = name + "/" + child, target = join(p.root, key);
      visit(target);
      const entry = info(target);
      if (entry) nodes.set(key, { type: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : "file" });
    }
  }
  return nodes;
}
function preflightProject(p) {
  // Inspect the supplied spelling before any canonicalisation can conceal a link.
  let ancestor = parse(p.root).root;
  for (const part of relative(ancestor, p.root).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, part);
    const stat = info(ancestor);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) refuse("The project root has a linked or uncheckable parent.");
  }
  inventory(p, (absolute) => checkPath(p, absolute));
  const data = readRecords(p);
  for (const [name, directory] of data.names) checkPath(p, join(p.root, name), directory);
  inventory(p, (absolute) => checkPath(p, absolute), directoryParents(data));
  for (const [folder, reserved] of [
    [".claude", (name) => name.startsWith("settings.json.tmp")],
    [".devgenie", (name) => name.startsWith("cac.install.json.tmp-") || name === "briefs.jsonl.tmp"],
  ]) {
    if (info(join(p.root, folder))) for (const name of readdirSync(join(p.root, folder))) {
      if (reserved(name)) refuse("A reserved undo staging entry already exists: " + folder + "/" + name);
    }
  }
}
function preflightHardlinks(p, names) {
  const paths = new Set([p.root]);
  for (const name of names) {
    let path = join(p.root, name);
    while (path !== p.root) { paths.add(path); path = dirname(path); }
  }
  for (const path of paths) {
    if (protectedPath(path)) continue;
    const stat = info(path);
    if (stat?.isFile() && stat.nlink > 1) refuse("A project file has hard links: " + local(p.root, path));
  }
}

// A read-only model of the existing undo decisions. Its output is also the apply report.
function projectPlan(p, data, nodes) {
  const lines = [], reported = new Set(), cleanup = [];
  function include(name) {
    let current = name;
    while (current && current !== ".") {
      if (!nodes.has(current)) {
        const stat = info(join(p.root, current));
        if (stat) nodes.set(current, { type: stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file" });
      }
      const parent = dirname(current).split(sep).join("/");
      if (parent === current) break;
      current = parent;
    }
  }
  for (const name of data.names.keys()) include(name);
  const has = (name) => nodes.has(name);
  const bytes = (name) => {
    const node = nodes.get(name);
    if (!node || node.type !== "file") return null;
    node.bytes ??= readFileSync(join(p.root, name));
    return node.bytes;
  };
  const text = (name) => bytes(name)?.toString("utf8") ?? "";
  function notice(line, name) { lines.push(display(line)); if (name) reported.add(name); }
  function remove(name, message = "removes: " + name, own = false) {
    if (!has(name)) return;
    nodes.delete(name);
    notice(message, name);
    if (own) cleanup.push({ name, type: "file" });
  }
  function emptyDirectory(name, own = false) {
    if (homeDevGenie(p, name)) {
      if (!reported.has(name)) notice("keeps: .devgenie (your home DevGenie folder is never removed)", name);
      return;
    }
    if (nodes.get(name)?.type !== "directory" || [...nodes.keys()].some((key) => key.startsWith(name + "/"))) return;
    nodes.delete(name);
    notice("removes: " + name, name);
    if (own) cleanup.push({ name, type: "directory" });
  }
  function prune(name, stop) {
    while (name !== stop && has(name)) {
      const before = has(name); emptyDirectory(name);
      if (before && has(name)) break;
      name = dirname(name).split(sep).join("/");
    }
  }
  function write(name, value) { nodes.set(name, { type: "file", bytes: Buffer.isBuffer(value) ? value : Buffer.from(value) }); }
  const settings = () => validateSettings(has(SETTINGS) ? JSON.parse(text(SETTINGS)) : {});
  function settingsChanges(next) {
    const entries = (obj) => [...Object.values(obj.hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks)), ...(plain(obj.statusLine) ? [obj.statusLine] : [])];
    const remaining = entries(next);
    for (const entry of entries(settings())) {
      const index = remaining.findIndex((h) => same(h, entry));
      if (index !== -1) remaining.splice(index, 1);
      else if (typeof entry.command === "string") notice("removes: " + SETTINGS + " hook entry " + entry.command + " (any change you made to that entry goes too)");
    }
  }
  function saveSettings(value, name, removeEmpty = false) {
    settingsChanges(value);
    const next = formatted(value), prior = bytes(SETTINGS);
    if (removeEmpty && Object.keys(value).length === 0) remove(SETTINGS);
    else {
      if (!prior || !prior.equals(next)) notice("removes: " + SETTINGS + " " + name + " settings entries");
      write(SETTINGS, next);
    }
  }
  function owned(name, hash) {
    if (!has(name)) return;
    if (bytes(name) && sha(bytes(name)) === hash) remove(name);
    else notice("kept: " + name + " (differs from the DevGenie original)", name);
  }
  const r = data.records;
  if (r.task) {
    if (r.task.block) {
      const md = text("CLAUDE.md"), start = "<!-- task-pointer:start -->", end = "<!-- task-pointer:end -->";
      const a = md.indexOf(start), b = md.indexOf(end);
      if (a !== -1 && b > a) {
        write("CLAUDE.md", (md.slice(0, a).replace(/\n+$/, "\n") + md.slice(b + end.length).replace(/^\n/, "")).replace(/^\n+$/, ""));
        notice("removes: CLAUDE.md task block between its markers (any edit you made inside the markers goes too)");
      }
    }
    if (r.task.settings.length) {
      const obj = settings();
      for (const entry of r.task.settings) {
        const groups = obj.hooks?.[entry.event];
        if (!groups) continue;
        for (const group of groups) group.hooks = group.hooks.filter((h) => h.command !== entry.command);
        obj.hooks[entry.event] = groups.filter((g) => g.hooks.length > 0);
        if (!obj.hooks[entry.event].length) delete obj.hooks[entry.event];
        if (!Object.keys(obj.hooks).length) delete obj.hooks;
      }
      saveSettings(obj, "task");
    }
    for (const [file, hash] of Object.entries(r.task.files)) owned(".claude/hooks/" + file, hash);
    remove(".devgenie/task-pointer.json"); remove(".devgenie/task-pointer.off");
  }
  if (r.test) {
    if (r.test.hook_added && has(SETTINGS)) {
      const obj = settings(), pre = obj.hooks?.PreToolUse;
      if (pre) {
        const isHandler = (h) => h.command === "node" && same(h.args, ["${CLAUDE_PROJECT_DIR}/.devgenie/test-gate-hook.mjs"]);
        obj.hooks.PreToolUse = pre.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isHandler(h)) })).filter((g, i) => g.hooks.length > 0 || pre[i].hooks.length === 0);
        if (!obj.hooks.PreToolUse.length) delete obj.hooks.PreToolUse;
        if (!Object.keys(obj.hooks).length) delete obj.hooks;
      }
      saveSettings(obj, "test", r.test.settings_created);
      if (!has(SETTINGS)) prune(".claude", ".");
    }
    for (const [file, hash] of Object.entries(r.test.files)) owned(file, hash);
    if (r.test.config_created) owned(".devgenie/test-gate.json", r.test.config_sha);
    remove(".devgenie/test-gate.install.json");
    prune(".devgenie/kit/test", ".devgenie"); prune(".devgenie/kit", ".devgenie");
  }
  if (r.cac) {
    if (r.cac.hook_added && has(SETTINGS)) {
      const original = bytes(SETTINGS), obj = settings();
      if (sha(original) === r.cac.settings_sha) {
        settingsChanges(r.cac.settings_created ? {} : JSON.parse(Buffer.from(r.cac.settings_original, "base64").toString("utf8")));
        if (r.cac.settings_created) remove(SETTINGS);
        else {
          const next = Buffer.from(r.cac.settings_original, "base64");
          if (!original.equals(next)) notice("removes: " + SETTINGS + " admission settings entries");
          write(SETTINGS, next);
        }
      } else {
        const handler = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.devgenie/cac-hook.mjs"], timeout: 10 };
        const match = (h) => Object.keys(h).length === Object.keys(handler).length && h.type === handler.type && h.command === handler.command && h.timeout === handler.timeout && same(h.args, handler.args);
        const pre = obj.hooks?.PreToolUse;
        if (pre) {
          obj.hooks.PreToolUse = pre.flatMap((g) => {
            if (g.matcher !== "Bash") return [g];
            const hooks = g.hooks.filter((h) => !match(h));
            return hooks.length === g.hooks.length ? [g] : hooks.length ? [{ ...g, hooks }] : [];
          });
          if (!obj.hooks.PreToolUse.length) delete obj.hooks.PreToolUse;
          if (!Object.keys(obj.hooks).length) delete obj.hooks;
        }
        if (r.cac.settings_created && !Object.keys(obj).length) settingsChanges(obj);
        if (r.cac.settings_created && !Object.keys(obj).length) remove(SETTINGS);
        else if (!same(JSON.parse(original.toString("utf8")), obj)) saveSettings(obj, "admission");
      }
    }
    for (const [file, hash] of Object.entries(r.cac.files)) owned(file, hash);
    if (r.cac.config_created) owned(".devgenie/cac.json", r.cac.config_sha);
    remove(".devgenie/cac.install.json");
    for (const dir of [...r.cac.directories].sort(deepest)) emptyDirectory(dir);
  }
  if (r.sessions) {
    if (has(SETTINGS) && (r.sessions.hook_added || r.sessions.statusline_added)) {
      const obj = settings();
      if (r.sessions.hook_added) {
        const groups = obj.hooks?.SessionEnd;
        const handler = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.devgenie/sessions/session-end.mjs"], timeout: 10 };
        if (groups) obj.hooks.SessionEnd = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !same(h, handler)) }))
          .filter((g, i) => g.hooks.length || !groups[i].hooks.length || Object.keys(g).length > 1);
        if (r.sessions.end_created && obj.hooks?.SessionEnd?.length === 0) delete obj.hooks.SessionEnd;
        if (r.sessions.hooks_created && obj.hooks && !Object.keys(obj.hooks).length) delete obj.hooks;
      }
      const status = { type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.devgenie/sessions/statusline.mjs"' };
      if (r.sessions.statusline_added && same(obj.statusLine, status)) delete obj.statusLine;
      saveSettings(obj, "sessions", r.sessions.settings_created);
    }
    for (const [file, hash] of Object.entries(r.sessions.files)) owned(file, hash);
    remove(".devgenie/sessions.install.json");
  }
  if (r.raise) {
    const obj = settings(), pre = obj.hooks?.PreToolUse;
    let changed = false;
    if (Array.isArray(pre)) {
      const command = 'node "$CLAUDE_PROJECT_DIR/.devgenie/kit/raise/records.mjs" hook';
      const kept = [];
      for (const group of pre) {
        const hooks = group.hooks, rest = hooks.filter((h) => h.command !== command);
        if (hooks.length !== rest.length) changed = true;
        if (rest.length === hooks.length) kept.push(group);
        else if (rest.length) kept.push({ ...group, hooks: rest });
      }
      if (changed) {
        if (kept.length) obj.hooks.PreToolUse = kept; else delete obj.hooks.PreToolUse;
        if (!Object.keys(obj.hooks).length) delete obj.hooks;
        saveSettings(obj, "raise");
      }
    }
    for (const file of r.raise.files) {
      if (!has(file.path)) continue;
      if (bytes(file.path)?.equals(Buffer.from(file.body.replace(/\r\n/g, "\n")))) remove(file.path);
      else notice("kept: " + file.path + " (differs from the DevGenie original)", file.path);
    }
    remove(".devgenie/kit-raise.json");
  }
  if (r["coarch"]) {
    for (const file of r["coarch"].files) {
      if (!has(file.path)) continue;
      if (text(file.path) === file.body) remove(file.path, "removes: " + file.path + " (identical to the DevGenie starter; kept if you changed it)");
      else notice("kept: " + file.path + " (differs from the DevGenie original)", file.path);
      const dir = dirname(file.path).split(sep).join("/");
      if (dir !== ".") emptyDirectory(dir);
    }
    remove(".devgenie/kit/coarch.json");
  }
  for (const name of LEFTOVERS.concat(STAGED)) if (nodes.get(name)?.type === "file") remove(name, "removes: " + name, true);
  const directories = new Set(FIXED_DIRS);
  for (const [name, node] of nodes) if (node.type === "directory" && name.startsWith(".devgenie/kit-incoming/")) directories.add(name);
  for (const name of [...directories].sort(deepest)) emptyDirectory(name, true);
  for (const name of [...(p.entry?.created ?? [])].sort(deepest)) {
    if (nodes.get(name)?.type === "directory") emptyDirectory(name, true);
    else if (name === SETTINGS && has(name)) {
      if (same(JSON.parse(text(name)), {})) remove(name, "removes: " + name, true);
    } else if (name === "CLAUDE.md" && has(name) && !text(name).trim()) remove(name, "removes: " + name, true);
    if (has(name) && !reported.has(name)) notice("keeps: " + name + " (contains project content)", name);
  }
  emptyDirectory(".devgenie", true);
  for (const [name, node] of [...nodes].sort(([a], [b]) => a.localeCompare(b))) {
    if (node.type === "directory") {
      if ((name === ".devgenie" || name.startsWith(".devgenie/")) && !reported.has(name)) notice("keeps: " + name + " (contains retained project entries)", name);
      continue;
    }
    if (BUILT.includes(name) || /^\.devgenie\/scripts\/[^/]+\.sh$/.test(name)) notice("left: " + name + " (part of the project DevGenie built)", name);
    else if (!reported.has(name) && (name.startsWith(".devgenie/kit/task/") || name.startsWith(".devgenie/kit-incoming/"))) notice("keeps: " + name + " (not a DevGenie file name)", name);
    else if (!reported.has(name) && name.startsWith(".devgenie/")) notice("keeps: " + name + " (not owned by a saved installation)", name);
  }
  if (has("metrics/token-ledger.jsonl")) notice("keeps: metrics/token-ledger.jsonl (may have another writer)");
  if (has(SETTINGS) && !reported.has(SETTINGS)) notice("keeps: " + SETTINGS + " (contains project settings)");
  if (has("CLAUDE.md") && !reported.has("CLAUDE.md")) notice("keeps: CLAUDE.md (contains project content)");
  return { lines, cleanup };
}

function prepareProject(p) {
  preflightProject(p);
  const data = readRecords(p);
  if (homeDevGenie(p, ".devgenie") && data.records.cac?.directories.includes(".devgenie")) {
    say("keeps: .devgenie (your home DevGenie folder is never removed)");
    refuse("The saved admission undo could remove your home DevGenie folder.");
  }
  const nodes = inventory(p, () => {}, directoryParents(data));
  preflightHardlinks(p, new Set([...data.names.keys(), ...nodes.keys()]));
  if (info(join(p.root, SETTINGS))) validateSettings(jsonAt(p, SETTINGS));
  p.records = data.records;
  p.plan = projectPlan(p, data, nodes);
}
function runUndo(p, name, args) {
  const script = PRACTICES.find(([id]) => id === name)[2];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    cwd: p.root, env: { ...process.env, CLAUDE_PROJECT_DIR: p.root }, shell: false,
    encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  p.undoOutput.push({ name, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  if (result.error || result.status !== 0) refuse(name + " undo stopped; earlier completed changes remain. The project stays on the list.");
}
function cleanupRaise(p) {
  for (const file of p.records.raise.files) {
    const destination = join(p.root, file.path);
    if (!info(destination)?.isFile()) continue;
    const body = readFileSync(destination).toString("base64");
    const expected = Buffer.from(file.body.replace(/\r\n/g, "\n")).toString("base64");
    if (body === expected) rmSync(destination);
  }
  rmSync(join(p.root, ".devgenie/kit-raise.json"));
}
function cleanupLeftovers(p) {
  for (const action of p.plan.cleanup) {
    if (action.type === "directory" && homeDevGenie(p, action.name)) continue;
    const absolute = join(p.root, action.name), stat = info(absolute);
    if (!stat) continue;
    if (action.type === "directory") {
      if (stat.isDirectory() && readdirSync(absolute).length === 0) rmdirSync(absolute);
    } else if (stat.isFile()) {
      if (action.name === SETTINGS && !same(JSON.parse(readFileSync(absolute, "utf8")), {})) continue;
      if (action.name === "CLAUDE.md" && readFileSync(absolute, "utf8").trim()) continue;
      rmSync(absolute);
    }
  }
}
function applyProject(p) {
  p.undoOutput = [];
  if (p.records.task) {
    runUndo(p, "task", ["uninstall"]);
  }
  if (p.records.test) {
    runUndo(p, "test", ["--undo"]);
  }
  if (p.records.cac) {
    runUndo(p, "cac", ["--undo"]);
  }
  if (p.records.sessions) {
    runUndo(p, "sessions", ["undo"]);
  }
  if (p.records.raise) {
    runUndo(p, "raise", ["guard-off"]);
    cleanupRaise(p);
  }
  if (p.records["coarch"]) {
    runUndo(p, "coarch", ["remove", ".devgenie/kit/coarch.json"]);
    rmSync(join(p.root, ".devgenie/kit/coarch.json"));
  }
  cleanupLeftovers(p);
  for (const line of p.plan.lines) {
    const kept = /^kept: (.*) \(differs from the DevGenie original\)$/.exec(line);
    if (kept && !info(join(p.root, kept[1]))) continue;
    say(line);
  }
}
function findCLI() {
  const path = Object.entries(process.env).find(([key]) => /^path$/i.test(key))?.[1] ?? "";
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory.replace(/^"|"$/g, ""), name);
    if (protectedPath(candidate)) continue;
    try { if (lstatSync(candidate).isFile()) return candidate; } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
function pluginCall(exe, args) {
  return spawnSync(exe, args, { shell: false, timeout: 30000, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}
function pluginList() {
  const exe = findCLI();
  if (!exe) return null;
  try {
    const result = pluginCall(exe, ["plugin", "list", "--json"]);
    if (result.error || result.status !== 0) return null;
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows) || rows.some((r) => !plain(r) || typeof r.id !== "string" || !["user", "project", "local"].includes(r.scope))) return null;
    const plugins = rows.filter((row) => row.id.startsWith("devgenie@"));
    return { exe, plugins };
  } catch { return null; }
}
function fallback() { say("left: /plugin uninstall devgenie@smartgenie (run this yourself if plugin removal is still needed)"); }
function planPlugins(refused) {
  const result = pluginList();
  if (refused) {
    for (const row of result?.plugins ?? []) say("keeps: plugin " + row.id + " (not removed while a project is refused)");
    return;
  }
  if (!result) { say("Apply will print the manual plugin command because listing is unavailable."); fallback(); return; }
  for (const row of result.plugins) say("removes: plugin " + row.id + " (scope: " + row.scope + ")");
}
function removePlugins() {
  const result = pluginList();
  if (!result) { fallback(); return false; }
  let failed = false;
  for (const row of result.plugins) {
    const removal = pluginCall(result.exe, ["plugin", "uninstall", "-s", row.scope, row.id]);
    if (removal.error || removal.status !== 0) { failed = true; fallback(); }
    else say("removes: plugin " + row.id + " (scope: " + row.scope + ")");
  }
  return failed;
}
function machineAdvice() {
  say("Optional: /plugin marketplace remove smartgenie");
  say("Your DevGenie account remains; use the portal to close it.");
}
function updateList(store, projects, all) {
  const projectsFile = store.file;
  if (!store.exists) return;
  readProjects();
  if (all && projects.length === 0) {
    rmSync(projectsFile);
    return;
  }
  if (same(projects, store.data.projects)) return;
  const temporary = projectsFile + ".tmp-" + process.pid + "-" + randomUUID();
  let made = false;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, projects }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    made = true;
    renameSync(temporary, projectsFile);
    made = false;
  } finally { if (made) rmSync(temporary, { force: true }); }
}
function argumentsFor(argv) {
  const [verb, ...args] = argv, opts = { all: false, also: [] };
  if (!["plan", "apply"].includes(verb)) return null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all" && !opts.all) opts.all = true;
    else if (args[i] === "--also" && args[i + 1] && !args[i + 1].startsWith("--")) opts.also.push(args[++i]);
    else return null;
  }
  if (opts.also.length && !opts.all) return null;
  return { verb, opts };
}
function main() {
  const parsed = argumentsFor(process.argv.slice(2));
  if (!parsed) { say("refused: Use plan or apply, optionally --all and repeated --also <folder>; --also needs --all."); return 2; }
  const { verb, opts } = parsed;
  if (opts.all) {
    const command = 'node "' + resolve(here, "../../..", "scripts/signin.mjs") + '" --sign-out';
    say("Sign out in a terminal of your own with " + command + " before confirming removal; the plugin contains that command. /mcp shows the connection.");
  }
  say("Saved records have limits: overwritten original bytes cannot be restored; a pre-existing identical starter is removed under the disclosed comparison rule.");
  say("Listed-name staged kit files go even if edited; unknown names stay. Task-block edits inside its markers go too, and neighbouring whitespace may change.");
  say("left: ~/.claude/settings.json (a possible retained project status line; user settings were not inspected)");
  const store = readProjects(), list = store.data;
  const candidates = [process.env.CLAUDE_PROJECT_DIR || process.cwd(), ...opts.also];
  if (opts.all) {
    for (const entry of list.projects) {
      candidates.push(entry.root);
    }
  }
  const seen = new Set(), projects = [], completed = new Set();
  let failed = false;
  for (const folder of candidates) {
    const root = resolve(folder);
    try {
      if (protectedPath(root)) refuse("Sign-in storage is outside project cleanup.");
      const stat = info(root);
      if (!stat) {
        if (!seen.has(root)) say("keeps: " + display(root) + " (gone; removed from the list during apply)");
        seen.add(root); completed.add(root); continue;
      }
      const canonical = realpathSync(root);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const p = { root, canonical, entry: list.projects.find((e) => e.root === canonical) };
      prepareProject(p);
      projects.push(p);
    } catch (error) { failed = true; say("refused: " + display(root) + ": " + display(error.message)); }
  }
  if (verb === "plan") {
    for (const p of projects) {
      say("Project: " + display(p.root));
      p.plan.lines.forEach(say);
    }
    if (opts.all) { planPlugins(failed); machineAdvice(); }
    return failed ? 1 : 0;
  }
  for (const p of projects) {
    say("Project: " + display(p.root));
    try { applyProject(p); completed.add(p.canonical); }
    catch (error) { failed = true; say("refused: " + display(p.root) + ": " + display(error.message)); }
  }
  updateList(store, list.projects.filter((entry) => !completed.has(entry.root)), opts.all);
  if (opts.all && !failed) {
    failed = removePlugins();
  }
  if (opts.all) machineAdvice();
  return failed ? 1 : 0;
}
try { process.exitCode = main(); }
catch (error) { say("refused: " + display(error.message)); process.exitCode = 1; }
