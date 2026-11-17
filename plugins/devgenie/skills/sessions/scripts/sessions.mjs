#!/usr/bin/env node
// Project-scoped installation, removal, switches and local summaries.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const path = (name) => join(project, name);
const linked = (name) => name.split("/").some((_, i, parts) =>
  lstatSync(path(parts.slice(0, i + 1).join("/")), { throwIfNoEntry: false })?.isSymbolicLink());
const SETTINGS = ".claude/settings.json", RECORD = ".devgenie/sessions.install.json";
const SWITCH = ".devgenie/sessions.off";
const FILES = ["statusline", "session-end", "step-log"].map((name) => `.devgenie/sessions/${name}.mjs`);
const HANDLER = { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/.devgenie/sessions/session-end.mjs"], timeout: 10 };
const STATUS = { type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.devgenie/sessions/statusline.mjs"' };
const plain = (obj) => obj !== null && typeof obj === "object" && !Array.isArray(obj);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const say = (text) => console.log(text);
class Refusal extends Error {}
const refuse = (text) => { throw new Refusal(text); };
const isHandler = (h) => same(h, HANDLER);
const entries = (settings) => (settings.hooks?.SessionEnd ?? []).flatMap((g) => g.hooks);
const ledgerArgs = (args) => (typeof args === "string" ? args.match(/"[^"]*"|'[^']*'|\S+/g) ?? [] : Array.isArray(args) ? args : [])
  .some((arg) => typeof arg === "string" &&
    /record-tokens.*\.(?:sh|bash|zsh|ksh|[cm]?js|[cm]?ts|py|rb|pl|ps1|cmd|bat)$/.test(arg.replace(/^(['"])(.*)\1$/, "$2").split(/[\\/]/).at(-1)));

function readSettings() {
  if (!existsSync(path(SETTINGS))) return {};
  let settings;
  try { settings = JSON.parse(readFileSync(path(SETTINGS), "utf8")); }
  catch { refuse("The project settings are not valid JSON, so nothing was changed."); }
  if (!plain(settings) || ("hooks" in settings && !plain(settings.hooks))) refuse("The project settings have an unsafe shape, so nothing was changed.");
  if (settings.hooks && "SessionEnd" in settings.hooks) {
    const groups = settings.hooks.SessionEnd;
    if (!Array.isArray(groups) || groups.some((g) => !plain(g) || !Array.isArray(g.hooks) || g.hooks.some((h) => !plain(h)))) {
      refuse("The session hooks have an unsafe shape, so nothing was changed.");
    }
  }
  return settings;
}

function readRecord() {
  if (!existsSync(path(RECORD))) return { files: {}, settings: [], hook_added: false, statusline_added: false, settings_created: false };
  let record;
  try { record = JSON.parse(readFileSync(path(RECORD), "utf8")); } catch { refuse("The sessions install record is not valid JSON, so nothing was changed."); }
  if (!plain(record) || !plain(record.files) || Object.keys(record.files).some((f) => !FILES.includes(f))) {
    refuse("The sessions install record has an unsafe shape, so nothing was changed.");
  }
  return record;
}

function write(name, text) {
  mkdirSync(dirname(path(name)), { recursive: true });
  writeFileSync(path(name), text);
}
const writeJson = (name, obj) => write(name, JSON.stringify(obj, null, 2) + "\n");

function addHandler(settings) {
  settings.hooks ??= {};
  settings.hooks.SessionEnd ??= [];
  settings.hooks.SessionEnd.push({ hooks: [HANDLER] });
}

function dropHandler(settings) {
  const groups = settings.hooks?.SessionEnd;
  if (!groups) return;
  settings.hooks.SessionEnd = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isHandler(h)) }))
    .filter((g, i) => g.hooks.length || !groups[i].hooks.length || Object.keys(g).length > 1);
}

async function install() {
  const settings = readSettings(), record = readRecord();
  const existed = existsSync(path(SETTINGS));
  try {
    const { recordProject } = await import(new URL("../../uninstall/scripts/projects.mjs", import.meta.url));
    await recordProject(project);
  } catch {}
  const usable = new Set();
  for (const file of FILES) {
    const bytes = readFileSync(join(here, file.split("/").at(-1)));
    if (!existsSync(path(file))) {
      write(file, bytes);
      record.files[file] = sha(bytes);
      usable.add(file);
      say(`added ${file}`);
    } else if (readFileSync(path(file)).equals(bytes)) {
      usable.add(file);
      say(`already present ${file}`);
    } else say(`kept ${file} because it differs from the bundled script`);
  }
  let changed = false;
  if (!("statusLine" in settings) && usable.has(FILES[0])) {
    settings.statusLine = STATUS;
    record.statusline_added = true;
    changed = true;
    say("added the project status line");
  } else if ("statusLine" in settings) say("kept the existing project status line");
  if (!entries(settings).some(isHandler) && usable.has(FILES[1])) {
    record.hooks_created ??= !("hooks" in settings);
    record.end_created ??= !("SessionEnd" in (settings.hooks ?? {}));
    addHandler(settings);
    record.hook_added = true;
    record.settings = [{ event: "SessionEnd", handler: HANDLER }];
    changed = true;
    say("added the session-end hook");
  }
  if (changed) {
    if (!existed) record.settings_created = true;
    writeJson(SETTINGS, settings);
  }
  say(entries(settings).some((h) => /record-tokens/.test(typeof h.command === "string" ? h.command : "") || ledgerArgs(h.args))
    ? "the token log from the task practice is already wired and is reused"
    : "no token log is wired, run /devgenie:task to add one; the session log works without it");
  writeJson(RECORD, record);
  say("start a new session for the hooks to take effect");
}

function undo() {
  if (!existsSync(path(RECORD))) return say("There is no sessions installation to undo.");
  const record = readRecord();
  const settings = readSettings();
  if (existsSync(path(SETTINGS)) && (record.hook_added || record.statusline_added)) {
    if (record.hook_added) {
      dropHandler(settings);
      if (record.end_created && settings.hooks?.SessionEnd?.length === 0) delete settings.hooks.SessionEnd;
      if (record.hooks_created && settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }
    if (record.statusline_added && same(settings.statusLine, STATUS)) delete settings.statusLine;
    if (record.settings_created && Object.keys(settings).length === 0) unlinkSync(path(SETTINGS));
    else writeJson(SETTINGS, settings);
    say("removed the unchanged settings entries added by sessions");
  }
  for (const [file, hash] of Object.entries(record.files)) {
    if (!existsSync(path(file))) continue;
    if (sha(readFileSync(path(file))) === hash) {
      unlinkSync(path(file));
      say(`removed ${file}`);
    } else say(`kept ${file} because it changed after install`);
  }
  unlinkSync(path(RECORD));
  say("The local records are kept.");
}

function rows(name) {
  if (!existsSync(path(name))) return [];
  return readFileSync(path(name), "utf8").split(/\r?\n/).flatMap((line) => {
    try { const row = JSON.parse(line); return plain(row) ? [row] : []; } catch { return []; }
  });
}

function report() {
  const latest = new Map(), tokens = new Map();
  for (const row of rows(".devgenie/sessions.jsonl")) {
    if (typeof row.session !== "string" || !Number.isFinite(Date.parse(row.start)) || !Number.isFinite(row.duration_s)) continue;
    latest.delete(row.session);
    latest.set(row.session, row);
  }
  for (const row of rows("metrics/token-ledger.jsonl")) {
    const billed = row.tokens?.total_billed;
    if (typeof row.session === "string" && Number.isFinite(billed) && billed >= 0) tokens.set(row.session, Math.max(tokens.get(row.session) ?? 0, billed));
  }
  for (const row of latest.values()) {
    const seconds = Math.round(row.duration_s);
    say(`${row.start}\t${Math.floor(seconds / 60)}m ${seconds % 60}s\t${tokens.get(row.session) ?? "-"}\t${row.session.replace(/[\r\n\t]/g, " ")}`);
  }
}

try {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !["install", "undo", "off", "on", "report"].includes(command)) refuse("Use sessions.mjs with install, undo, off, on or report.");
  if (command !== "report" && (["install", "undo"].includes(command) ? [SETTINGS, RECORD, ...FILES] : [SWITCH]).some(linked))
    refuse("A project path is a link, so nothing was changed.");
  if (command === "install") await install();
  else if (command === "undo") undo();
  else if (command === "off") { write(SWITCH, ""); say("Session records are off for this project."); }
  else if (command === "on") { if (existsSync(path(SWITCH))) unlinkSync(path(SWITCH)); say("Session records are on for this project."); }
  else report();
} catch (err) {
  console.error(err instanceof Refusal ? err.message : "The sessions command could not access a local file.");
  process.exitCode = 1;
}
