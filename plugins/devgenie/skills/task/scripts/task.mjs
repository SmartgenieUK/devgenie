#!/usr/bin/env node
// task.mjs - install, set, show and report the active-task pointer for ONE project.
//
//   node task.mjs install <kit-dir>   add the CLAUDE.md block from the fetched kit and wire the hooks (opt-in, safe to repeat)
//   node task.mjs uninstall   undo exactly what install added
//   node task.mjs set <name>  point the ACTIVE TASK line at <name> (or 'none')
//   node task.mjs show        print the current task and its totals so far
//   node task.mjs report      rebuild .devgenie/tasks.jsonl and print the totals per task
//   node task.mjs off | on    switch both hooks off (and back on) for this project without uninstalling
//
// The project is $CLAUDE_PROJECT_DIR, else the current directory. Everything is project-scoped: nothing is written
// to the plugin, to user settings or outside the project. Exit 0 on success, 1 with one plain message on a refusal.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POINTER_RE, readPointer, writeReport } from "./task-report.mjs";

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_FILES = ["check-pointer.mjs", "task-report.mjs", "record-tokens.sh"];
const START = "<!-- task-pointer:start -->";
const END = "<!-- task-pointer:end -->";
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// The two settings entries. The ledger entry is added only when the project has no ledger hook of its own.
const POINTER_CMD = 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-pointer.mjs"';
const LEDGER_CMD = 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/record-tokens.sh"';

const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const path = (...p) => join(proj, ...p);
const say = (m) => process.stdout.write(`${m}\n`);
class Refusal extends Error {}
const refuse = (m) => {
  throw new Refusal(m);
};

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const readText = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

function readSettings() {
  const text = readText(path(".claude", "settings.json"));
  if (text === null) return {};
  try {
    const s = JSON.parse(text);
    if (s && typeof s === "object" && !Array.isArray(s)) return s;
  } catch {
    /* fall through to the refusal */
  }
  return refuse(".claude/settings.json is not valid JSON, so nothing was changed. Fix or remove it, then run install again.");
}

const entriesOf = (settings, event) => (settings.hooks?.[event] ?? []).flatMap((g) => g?.hooks ?? []);

function addEntry(settings, event, command, timeout) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  settings.hooks[event].push({ hooks: [{ type: "command", command, timeout }] });
}

function removeEntry(settings, event, command) {
  const groups = settings.hooks?.[event];
  if (!groups) return;
  for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => h.command !== command);
  settings.hooks[event] = groups.filter((g) => (g.hooks ?? []).length > 0);
  if (settings.hooks[event].length === 0) delete settings.hooks[event];
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

const MANIFEST = () => path(".devgenie", "task-pointer.json");

function install(kitDir) {
  const blockFile = kitDir ? join(kitDir, "claude-block.md") : "";
  if (!blockFile || !existsSync(blockFile)) refuse("install needs the fetched kit: pass the folder that holds claude-block.md (the skill fetches it from DevGenie first).");
  const blockText = readFileSync(blockFile, "utf8");
  if (!blockText.includes(START) || !blockText.includes(END)) refuse("claude-block.md in the kit is not a task pointer block, so nothing was changed.");
  const settings = readSettings(); // refuses before any change when the file cannot be parsed
  const prior = JSON.parse(readText(MANIFEST()) ?? "{}");
  const manifest = { block: false, files: {}, settings: [] };
  const done = [];

  // 1. The CLAUDE.md block.
  const claudeMd = readText(path("CLAUDE.md")) ?? "";
  if (claudeMd.includes(START)) {
    manifest.block = prior.block === true;
    done.push("CLAUDE.md: the block is already there");
  }
  else if (POINTER_RE.test(claudeMd)) done.push("CLAUDE.md: an ACTIVE TASK line already exists, so the block was not added (task.mjs set tidies that line)");
  else {
    const block = readFileSync(blockFile, "utf8").replace(/\r\n/g, "\n");
    writeFileSync(path("CLAUDE.md"), claudeMd + (claudeMd && !claudeMd.endsWith("\n\n") ? (claudeMd.endsWith("\n") ? "\n" : "\n\n") : "") + block);
    manifest.block = true;
    done.push("CLAUDE.md: added the Active task block");
  }

  // 2. The hook scripts, copied into the project. A file that is already there and different is never overwritten.
  const conflicts = new Set(); // hook files a different file is already in the way of
  mkdirSync(path(".claude", "hooks"), { recursive: true });
  for (const f of HOOK_FILES) {
    const dest = path(".claude", "hooks", f);
    const src = join(SKILL_DIR, "scripts", f);
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
      manifest.files[f] = sha(dest);
      done.push(`.claude/hooks/${f}: added`);
    } else if (readFileSync(dest, "utf8") === readFileSync(src, "utf8")) {
      if (prior.files?.[f]) manifest.files[f] = prior.files[f];
      done.push(`.claude/hooks/${f}: already there`);
    } else {
      conflicts.add(f);
      done.push(`.claude/hooks/${f}: left as it is (a different file is already there)`);
    }
  }

  // 3. The settings entries.
  const wire = (event, command, timeout) => {
    if (entriesOf(settings, event).some((h) => h.command === command)) {
      if ((prior.settings ?? []).some((s) => s.command === command)) manifest.settings.push({ event, command });
      done.push(`.claude/settings.json: ${event} entry already there`);
    } else {
      addEntry(settings, event, command, timeout);
      manifest.settings.push({ event, command });
      done.push(`.claude/settings.json: added the ${event} entry`);
    }
  };
  // Each entry is wired only when every file it runs is the skill's own, so a developer's file never runs in its place.
  const pointerBlocked = ["check-pointer.mjs", "task-report.mjs"].filter((n) => conflicts.has(n));
  if (pointerBlocked.length) {
    done.push(`.claude/settings.json: no session-start entry was added, because a different ${pointerBlocked.join(" and ")} is in the way. Move or remove it, then run install again.`);
  } else wire("SessionStart", POINTER_CMD, 10);
  if (conflicts.has("record-tokens.sh")) {
    done.push(".claude/settings.json: no session-end entry was added, because a different record-tokens.sh is in the way (an older ledger hook files an absent pointer as 'unattributed' and does not refresh the report until the next session starts). The session-start check is unaffected.");
  } else if (entriesOf(settings, "SessionEnd").some((h) => /record-tokens/.test(h.command ?? "") && h.command !== LEDGER_CMD)) {
    done.push(".claude/settings.json: a ledger hook is already wired, so none was added (an older one files an absent pointer as 'unattributed' and does not refresh the report until the next session starts)");
  } else {
    wire("SessionEnd", LEDGER_CMD, 30);
    if (conflicts.has("task-report.mjs")) {
      done.push(".claude/hooks/task-report.mjs: SessionEnd will skip the report refresh, because a different task-report.mjs is in the way (the ledger row is still written; move or remove the conflicting file, then run install again).");
    }
  }

  if (spawnSync("bash", ["-c", "command -v jq"], { stdio: "ignore" }).status !== 0) {
    done.push("warning: bash with jq was not found, so the ledger hook writes nothing until both are installed (the session-start check and the report work without them)");
  }
  mkdirSync(path(".claude"), { recursive: true });
  writeFileSync(path(".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  mkdirSync(path(".devgenie"), { recursive: true });
  writeFileSync(MANIFEST(), JSON.stringify(manifest, null, 2) + "\n");

  done.forEach((l) => say(l));
  say("The hooks start working in your next session. To undo all of this: node task.mjs uninstall");
}

function uninstall() {
  const text = readText(MANIFEST());
  if (text === null) return say("Nothing to undo: no install is recorded for this project.");
  const m = JSON.parse(text);
  if (m.block) {
    const md = readText(path("CLAUDE.md")) ?? "";
    const a = md.indexOf(START);
    const b = md.indexOf(END);
    if (a !== -1 && b > a) {
      const out = (md.slice(0, a).replace(/\n+$/, "\n") + md.slice(b + END.length).replace(/^\n/, "")).replace(/^\n+$/, "");
      writeFileSync(path("CLAUDE.md"), out);
      say("CLAUDE.md: removed the Active task block");
    }
  }
  if ((m.settings ?? []).length) {
    const settings = readSettings();
    for (const s of m.settings) removeEntry(settings, s.event, s.command);
    writeFileSync(path(".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
    say("settings: removed the entries install added");
  }
  for (const [f, hash] of Object.entries(m.files ?? {})) {
    const p = path(".claude", "hooks", f);
    if (!existsSync(p)) continue;
    if (sha(p) !== hash) {
      say(`.claude/hooks/${f}: left in place (it was changed after install)`);
      continue;
    }
    rmSync(p);
    say(`.claude/hooks/${f}: removed`);
  }
  rmSync(MANIFEST(), { force: true });
  rmSync(path(".devgenie", "task-pointer.off"), { force: true });
  say("Left in place: metrics/token-ledger.jsonl and .devgenie/tasks.jsonl (your records).");
}

function set(name) {
  if (name !== "none" && !SLUG_RE.test(name ?? "")) {
    refuse("A task name is lower-case letters, digits, '.', '_' or '-', starting with a letter or digit, at most 64 characters (for example login-page), or 'none'.");
  }
  const md = readText(path("CLAUDE.md"));
  if (md === null || !POINTER_RE.test(md)) refuse("CLAUDE.md has no ACTIVE TASK line. Run: node task.mjs install");
  // The whole line becomes the plain pointer: a bold or decorated line would put its markup into the ledger's task.
  writeFileSync(path("CLAUDE.md"), md.replace(/^.*ACTIVE TASK( POINTER)?:[ \t]*\S+.*$/im, () => `ACTIVE TASK: ${name}`));
  say(`ACTIVE TASK: ${name}`);
}

function show() {
  const task = readPointer(proj);
  if (task === null) return say("No ACTIVE TASK line in CLAUDE.md. Run: node task.mjs install");
  const t = writeReport(proj).find((r) => r.task === task);
  say(`ACTIVE TASK: ${task}`);
  say(t ? `${t.sessions} session(s), ${t.total_billed} tokens so far` : "No finished session is filed under it yet.");
}

function off() {
  mkdirSync(path(".devgenie"), { recursive: true });
  writeFileSync(path(".devgenie", "task-pointer.off"), "");
  say("The task pointer hooks are off for this project. Run: node task.mjs on");
}

function on() {
  rmSync(path(".devgenie", "task-pointer.off"), { force: true });
  say("The task pointer hooks are on for this project.");
}

function report() {
  const rows = writeReport(proj);
  if (!rows.length) return say("No finished sessions in metrics/token-ledger.jsonl yet.");
  for (const r of rows) say(`${r.task}\t${r.sessions} session(s)\t${r.total_billed} tokens`);
  if (rows.skipped) say(`${rows.skipped} unreadable ledger line(s) were skipped, so the totals may be low.`);
  say("Written to .devgenie/tasks.jsonl");
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "install") install(arg);
  else if (cmd === "uninstall") uninstall();
  else if (cmd === "set") set(arg);
  else if (cmd === "show") show();
  else if (cmd === "report") report();
  else if (cmd === "off") off();
  else if (cmd === "on") on();
  else refuse("Usage: node task.mjs install <kit-dir> | uninstall | set <name> | show | report | off | on");
} catch (err) {
  process.stderr.write(`${err instanceof Refusal ? "" : "task: unexpected failure: "}${err.message}\n`);
  process.exit(1);
}
