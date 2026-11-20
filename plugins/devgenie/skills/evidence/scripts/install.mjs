// install.mjs: switches the evidence gate on (from the saved kit) or off (--remove) for one project.
//
//   node install.mjs --check [--project <dir>]     before saving the kit: is it safe to save and install here?
//   node install.mjs [--project <dir>]             on, from the kit saved at KIT_REL
//   node install.mjs --remove [--project <dir>]    off
//
// The kit is the server's answer for this practice, saved as JSON at KIT_REL: { instructions, files: [{ path, body }] }.
// This script judges nothing in it: it writes each file where the kit says, copies evidence-report.mjs (beside this
// script) next to the gate, adds the three hook entries to <project>/.claude/settings.json, records what it wrote in
// MANIFEST_REL, and deletes the saved kit. Running it again with the same kit changes nothing.
// Off: removes exactly those three entries and the files the manifest lists. The refusals report is kept.
// Other settings, other hooks and any file this script did not write are never changed. Every check runs before
// anything is written: on a problem it exits 1 with a plain message and changes nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GATE_REL = ".claude/hooks/evidence-gate.mjs"; // the kit must carry the gate at this path; the hooks run it
const REPORT_MODULE_REL = ".claude/hooks/evidence-report.mjs"; // this skill's report writer, beside the gate
const SETTINGS_REL = ".claude/settings.json";
const MANIFEST_REL = ".devgenie/evidence-gate/installed.json"; // the files this script wrote, so --remove takes only those
const KIT_REL = ".devgenie/kit/evidence.json"; // the one place the skill saves the kit, checked by --check before it is written
const HOOK_TIMEOUT_S = 10; // the gate finishes well inside this; Claude Code stops waiting after it
// The three entries the gate needs: the event, its tool matcher (none for prompts), and the gate's mode.
const ENTRIES = [
  { event: "UserPromptSubmit", matcher: undefined, mode: "remind" },
  { event: "PostToolUse", matcher: "Read|Write|Edit|MultiEdit", mode: "after" },
  { event: "PreToolUse", matcher: "Write|Edit|MultiEdit", mode: "check" },
];
const entryHook = (mode) => ({ type: "command", command: "node", args: [`\${CLAUDE_PROJECT_DIR}/${GATE_REL}`, mode], timeout: HOOK_TIMEOUT_S });
const isEntry = (h, mode) => JSON.stringify(h) === JSON.stringify(entryHook(mode));
const ownGroup = (g, matcher) => (g.matcher ?? undefined) === matcher; // an entry is ours only under its own matcher
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function fail(message) {
  console.error(`evidence gate: ${message} Nothing was changed.`);
  process.exit(1);
}

/** A kit path is relative, uses forward slashes, and has no empty, "." or ".." segment. */
const safeRel = (p) => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.includes("\\") && ![...p].some((c) => c.charCodeAt(0) < 32) &&
  p.split("/").every((s) => s !== "" && s !== "." && s !== "..");

// What an install changes is put back if it fails halfway: each change pushes the step that undoes it.
const undo = [];

try {
  const args = process.argv.slice(2);
  const remove = args.includes("--remove");
  const preflight = args.includes("--check");
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const project = path.resolve(opt("--project") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const at = (rel) => path.join(project, ...rel.split("/"));
  const settingsPath = at(SETTINGS_REL);
  const manifestPath = at(MANIFEST_REL);

  // ---- every check first
  // Containment through links: every existing component of a path this script reads, writes or deletes, from the
  // project down, must be a real folder or file, or a link that resolves inside the project. A dangling link is refused.
  const realProject = fs.realpathSync.native(project);
  const inside = (real) => { const r = path.relative(realProject, real); return r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r)); };
  const contained = (rel) => {
    let p = project;
    for (const part of rel.split("/")) {
      p = path.join(p, part);
      let st;
      try { st = fs.lstatSync(p); } catch { return true; } // nothing there yet: what is created below lands inside
      if (!st.isSymbolicLink()) { if (!st.isDirectory() && p !== at(rel)) return false; continue; } // a file where a folder is needed
      let real;
      try { real = fs.realpathSync.native(p); } catch { return false; } // a dangling link
      if (!inside(real)) return false;
      if (p !== at(rel) && !fs.statSync(p).isDirectory()) return false; // a link to a file where a folder is needed
    }
    return true;
  };
  for (const rel of [SETTINGS_REL, MANIFEST_REL, REPORT_MODULE_REL, KIT_REL]) if (!contained(rel)) fail(`${rel} leads outside the project through a link.`);
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { fail(`${SETTINGS_REL} is not valid JSON; fix it by hand, then run this again.`); }
    if (!isObject(settings)) fail(`${SETTINGS_REL} is not a JSON object.`);
  }
  if ("hooks" in settings && !isObject(settings.hooks)) fail(`"hooks" in ${SETTINGS_REL} is not an object.`);
  const hooks = settings.hooks ?? {};
  for (const { event } of ENTRIES) {
    if (event in hooks && !Array.isArray(hooks[event])) fail(`hooks.${event} in ${SETTINGS_REL} is not a list.`);
    if ((hooks[event] ?? []).some((g) => !isObject(g) || ("hooks" in g && !Array.isArray(g.hooks)))) fail(`hooks.${event} in ${SETTINGS_REL} holds an entry that is not a hook group.`);
  }
  // The manifest: the files this script wrote and the hook entries it added (a matching entry that was already there
  // before the first install is the developer's own, so it is never recorded and never removed).
  let owned = [], ownedHooks = [];
  if (fs.existsSync(manifestPath)) {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { /* reported below */ }
    owned = m?.files; ownedHooks = m?.hooks;
    if (!Array.isArray(owned) || !owned.every(safeRel) || !Array.isArray(ownedHooks) || !ownedHooks.every((h) => ENTRIES.some((e) => e.mode === h))) {
      fail(`${MANIFEST_REL} is damaged; delete it by hand, then run this again.`);
    }
  }
  for (const rel of owned) if (!contained(rel)) fail(`${rel} leads outside the project through a link.`);
  if (preflight) {
    if (fs.existsSync(at(KIT_REL))) fail(`${KIT_REL} already exists (a kit left by an earlier run, or a file of your own); move it aside, then run this again.`);
    console.log(`evidence gate: ready to save the kit at ${KIT_REL} and install in ${project}.`);
    process.exit(0);
  }

  let kit = null;
  const kitPath = at(KIT_REL);
  if (!remove) {
    if (!fs.existsSync(kitPath)) fail(`no saved kit at ${KIT_REL}; save the kit tool's answer there first, or use --remove to switch the gate off.`);
    try { kit = JSON.parse(fs.readFileSync(kitPath, "utf8")); } catch { fail(`the kit at ${KIT_REL} cannot be read as JSON.`); }
    if (!isObject(kit) || typeof kit.instructions !== "string" || !Array.isArray(kit.files) || kit.files.length === 0) fail("the kit is not { instructions, files: [{ path, body }] }.");
    for (const f of kit.files) {
      if (!isObject(f) || !safeRel(f.path) || typeof f.body !== "string") fail("a kit file is not { path, body } with a relative path inside the project.");
      if ([REPORT_MODULE_REL, MANIFEST_REL, SETTINGS_REL, KIT_REL].some((r) => r.toLowerCase() === f.path.toLowerCase())) fail(`the kit may not write ${f.path}.`);
    }
    if (new Set(kit.files.map((f) => f.path.toLowerCase())).size !== kit.files.length) fail("the kit names one path twice.");
    // Compared without case: on Windows and macOS two spellings are one path. Every path this script writes is in the list.
    const kitPaths = [...kit.files.map((f) => f.path), REPORT_MODULE_REL, SETTINGS_REL, MANIFEST_REL].map((p) => p.toLowerCase());
    if (kitPaths.some((a) => kitPaths.some((b) => b.startsWith(a + "/")))) fail("the kit names a path that is both a file and a folder holding another path.");
    if (!kit.files.some((f) => f.path === GATE_REL)) fail(`the kit carries no ${GATE_REL}.`);
    for (const rel of [...kit.files.map((f) => f.path), REPORT_MODULE_REL]) {
      if (!contained(rel)) fail(`${rel} leads outside the project through a link.`);
      if (fs.existsSync(at(rel)) && !owned.includes(rel)) fail(`${rel} exists and was not written by this skill; move it aside, then run this again.`);
    }
  }

  // ---- then the change
  const changes = [];
  if (remove) {
    for (const { event, matcher, mode } of ENTRIES) {
      if (!hooks[event] || !ownedHooks.includes(mode)) continue;
      const kept = hooks[event]
        .map((g) => (Array.isArray(g.hooks) && ownGroup(g, matcher) ? { ...g, hooks: g.hooks.filter((h) => !isEntry(h, mode)) } : g))
        .filter((g, i) => !Array.isArray(g.hooks) || g.hooks.length > 0 || (hooks[event][i].hooks?.length ?? 0) === 0);
      if (JSON.stringify(kept) === JSON.stringify(hooks[event])) continue;
      changes.push(`removed the ${event} hook from ${SETTINGS_REL}`);
      if (kept.length) hooks[event] = kept; else delete hooks[event];
    }
    if (changes.length) {
      if (Object.keys(hooks).length === 0) delete settings.hooks;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
    for (const rel of owned) if (fs.existsSync(at(rel))) { fs.rmSync(at(rel)); changes.push(`deleted ${rel}`); }
    if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
  } else {
    const reportModule = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence-report.mjs"), "utf8");
    const toWrite = [...kit.files, { path: REPORT_MODULE_REL, body: reportModule }];
    // Make the folders a file needs one at a time, so each one made is noted before the next can fail.
    const mkdirs = (dir) => {
      const missing = [];
      for (let d = dir; !fs.existsSync(d); d = path.dirname(d)) missing.unshift(d);
      for (const d of missing) { fs.mkdirSync(d); undo.push(() => fs.rmdirSync(d)); }
    };
    // Write a file, noting how to put it back: its old bytes, or its removal.
    const put = (file, body) => {
      const had = fs.existsSync(file) ? fs.readFileSync(file) : null;
      mkdirs(path.dirname(file));
      undo.push(() => { if (had === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, had); });
      fs.writeFileSync(file, body);
    };
    for (const f of toWrite) {
      const current = fs.existsSync(at(f.path)) ? fs.readFileSync(at(f.path), "utf8") : null;
      if (current === f.body) continue;
      put(at(f.path), f.body);
      changes.push(`${current === null ? "wrote" : "updated"} ${f.path}`);
    }
    const files = toWrite.map((f) => f.path);
    const stale = owned.filter((rel) => !files.includes(rel));
    // A file the developer has since replaced with a link is theirs now: it is left alone, and never recorded again.
    for (const rel of stale) if (fs.existsSync(at(rel)) && !fs.lstatSync(at(rel)).isSymbolicLink()) {
      const gone = fs.readFileSync(at(rel));
      fs.rmSync(at(rel));
      undo.push(() => fs.writeFileSync(at(rel), gone));
      changes.push(`deleted ${rel} (no longer in the kit)`);
    }
    let added = false;
    const hooksNow = [...ownedHooks];
    for (const { event, matcher, mode } of ENTRIES) {
      const groups = hooks[event] ?? [];
      if (groups.some((g) => ownGroup(g, matcher) && (g.hooks ?? []).some((h) => isEntry(h, mode)))) continue;
      hooks[event] = [...groups, { ...(matcher ? { matcher } : {}), hooks: [entryHook(mode)] }];
      if (!hooksNow.includes(mode)) hooksNow.push(mode);
      changes.push(`added the ${event} hook (${mode}) to ${SETTINGS_REL}`);
      added = true;
    }
    if (added) {
      settings.hooks = hooks;
      put(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
    if (JSON.stringify({ files: owned, hooks: ownedHooks }) !== JSON.stringify({ files, hooks: hooksNow })) {
      put(manifestPath, JSON.stringify({ files, hooks: hooksNow }, null, 2) + "\n");
    }
    fs.rmSync(kitPath, { force: true });
  }

  console.log(changes.length
    ? `evidence gate ${remove ? "off" : "on"} in ${project}:\n${changes.map((c) => `  - ${c}`).join("\n")}`
    : `evidence gate already ${remove ? "off" : "on"} in ${project}; nothing changed.`);
  if (changes.length) console.log("Restart Claude Code (or open /hooks) so the session picks up the change.");
} catch (err) {
  let back = "";
  if (undo.length) {
    for (const step of undo.reverse()) { try { step(); } catch { back = " Some of it could not be put back; run --remove, then this again."; } }
    back ||= " Everything this run changed was put back.";
  }
  console.error(`evidence gate: could not finish (${err?.message ?? err}).${back} Run this again once that is fixed.`);
  process.exit(1);
}
