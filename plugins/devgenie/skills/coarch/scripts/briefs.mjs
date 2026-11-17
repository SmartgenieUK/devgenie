#!/usr/bin/env node
// briefs.mjs - the file mechanics of two-window working, run from the project root. It writes what it is handed and
// records status changes; the instructions and the starter files themselves come from DevGenie's kit.
//
//   node briefs.mjs install <kit.json>   write each kit file that is not in the project yet; keep existing files
//   node briefs.mjs set <brief> <status> set a brief's status in the brief and the index, and add one report line
//   node briefs.mjs remove <kit.json>    delete the kit's files that are still exactly as installed
//
// <kit.json> is the saved kit result: { instructions, files: [{ path, body }] }, each path relative to the project.
// The report is .devgenie/briefs.jsonl: one JSON line per status change, holding only the time, the brief's name and
// the new status. It stays on this machine. Needs Node 18 or later and nothing else.

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

// Where the briefs and their index live, relative to the project root.
const BRIEFS_DIR = join("docs", "briefs");
// The local report: one JSON line per status change.
const REPORT = join(".devgenie", "briefs.jsonl");
// Every status a brief can hold, in the order a brief moves through them.
const STATUSES = ["drafting", "issued", "returned", "accepted", "rejected"];

function fail(message, code = 1) {
  console.error(`briefs: ${message}`);
  process.exit(code);
}

/** Whether anything, a dangling link included, sits at a path. */
function present(p) {
  try { lstatSync(p); return true; } catch { return false; }
}

/** Whether a project-relative path stays inside the project once links and junctions on the way are followed. A link
 *  at the path itself is refused outright, so a dangling link can never be written through. */
function insideProject(rel) {
  const root = realpathSync(process.cwd());
  const target = resolve(rel);
  if (present(target) && lstatSync(target).isSymbolicLink()) return false;
  let probe = target;
  while (!present(probe)) probe = dirname(probe);
  let real;
  try { real = realpathSync(probe); } catch { return false; } // a dangling link on the way leads nowhere known
  return real === root || real.startsWith(root + sep);
}

/** The kit's files, each checked to stay inside the project. */
function kitFiles(kitPath) {
  if (!kitPath) fail("usage: install|remove <kit.json>", 2);
  if (!existsSync(kitPath)) fail(`no kit file ${kitPath}`);
  let kit;
  try { kit = JSON.parse(readFileSync(kitPath, "utf8")); } catch { fail(`${kitPath} is not valid JSON`); }
  if (!kit || !Array.isArray(kit.files)) fail(`${kitPath} has no files list`);
  return kit.files.map((f) => {
    if (!f || typeof f.path !== "string" || typeof f.body !== "string") fail(`${kitPath} holds a file without a path and body`);
    const rel = normalize(f.path);
    if (isAbsolute(f.path) || f.path.includes("\\") || rel.split(/[\\/]/).includes("..") || !insideProject(rel)) fail(`refused path outside the project: ${f.path}`);
    return { to: rel, shown: f.path, body: f.body };
  });
}

async function install(kitPath) {
  try {
    const { recordProject } = await import(new URL("../../uninstall/scripts/projects.mjs", import.meta.url));
    await recordProject(process.cwd());
  } catch {}
  for (const { to, shown, body } of kitFiles(kitPath)) {
    if (present(to)) { console.log(`kept ${shown} (already there)`); continue; }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, body);
    console.log(`created ${shown}`);
  }
}

function remove(kitPath) {
  for (const { to, shown, body } of kitFiles(kitPath)) {
    if (!existsSync(to)) continue;
    if (readFileSync(to, "utf8") === body) { unlinkSync(to); console.log(`removed ${shown}`); }
    else console.log(`kept ${shown} (it has been edited)`);
    const dir = dirname(to);
    if (dir !== "." && existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  }
}

function set(brief, status) {
  if (!brief || !STATUSES.includes(status)) fail(`usage: set <brief> <${STATUSES.join("|")}>`, 2);
  const name = basename(brief).replace(/\.md$/, "");
  const briefFile = join(BRIEFS_DIR, `${name}.md`);
  const indexFile = join(BRIEFS_DIR, "INDEX.md");
  const files = [briefFile, indexFile, REPORT];
  for (const file of files) {
    if (!insideProject(file)) fail(`refused path outside the project: ${file}`);
  }
  if (!existsSync(indexFile)) fail("docs/briefs/INDEX.md is missing: run /devgenie:coarch first");
  if (!existsSync(briefFile)) fail(`no brief docs/briefs/${name}.md`);

  const statusLine = /^Status: ([^\r\n]*)/m;
  const text = readFileSync(briefFile, "utf8");
  const current = statusLine.exec(text);
  if (!current) fail(`docs/briefs/${name}.md has no "Status:" line`);
  const index = readFileSync(indexFile, "utf8");
  const line = new RegExp(`^- ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| [^|\\r\\n]*\\|`, "m");
  if (!line.test(index)) fail(`${name} is not listed in docs/briefs/INDEX.md: add its line first`);
  // One brief is issued at a time: finish the open loop before starting the next.
  const other = [...index.matchAll(/^- (\S+) \| issued \|/gm)].map((m) => m[1]).find((n) => n !== name);
  if (status === "issued" && other) fail(`${other} is already issued: it must be returned, accepted or rejected before ${name} is issued`);
  // Setting the status a brief already has changes nothing and adds no report line.
  if (current[1].trim() === status && index.match(line)[0] === `- ${name} | ${status} |`) {
    console.log(`${name} is already ${status}; nothing changed`);
    return;
  }

  // Validate every staging path before writing anything; pre-existing entries belong to someone else.
  for (const file of files) {
    const stage = `${file}.tmp`;
    if (!insideProject(stage)) fail(`refused path outside the project: ${stage}`);
    if (present(stage)) fail(`refused existing staging path: ${stage}`);
  }
  mkdirSync(dirname(REPORT), { recursive: true });
  const report = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
  // Replacements go through functions so a "$" in a name is literal; [^\r\n] keeps a CRLF file's line endings.
  const changes = [
    [briefFile, text, text.replace(statusLine, () => `Status: ${status}`)],
    [indexFile, index, index.replace(line, () => `- ${name} | ${status} |`)],
    [REPORT, report, `${report}${JSON.stringify({ ts: new Date().toISOString(), brief: name, status })}\n`],
  ];
  // All or none. Stage: exclusively create each "<file>.tmp"; a failure there changes no real file. Then swap
  // each staged file in with a rename, which never leaves a half-written file; if a swap fails, the files already
  // swapped get their old text back. The report is rewritten whole, never appended, so no partial line can appear.
  const staged = new Set();
  try {
    for (const [file, , next] of changes) {
      const stage = `${file}.tmp`;
      const fd = openSync(stage, "wx");
      staged.add(stage);
      try { writeFileSync(fd, next); } finally { closeSync(fd); }
    }
  } catch (error) {
    for (const stage of staged) try { rmSync(stage, { force: true }); } catch { /* leave it; nothing real changed */ }
    throw error;
  }
  const swapped = [];
  try {
    for (const change of changes) {
      const stage = `${change[0]}.tmp`;
      renameSync(stage, change[0]);
      staged.delete(stage);
      swapped.push(change);
    }
  } catch (error) {
    const stuck = [];
    for (const [file, before] of swapped) try { writeFileSync(file, before); } catch { stuck.push(file); }
    for (const stage of staged) try { rmSync(stage, { force: true }); } catch { /* best effort */ }
    if (stuck.length) error.message += `; could not restore ${stuck.join(", ")}: set its status by hand`;
    throw error;
  }
  console.log(`${name} is now ${status}`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "install") await install(args[0]);
  else if (command === "remove") remove(args[0]);
  else if (command === "set") set(args[0], args[1]);
  else fail("usage: briefs.mjs install <kit.json> | set <brief> <status> | remove <kit.json>", 2);
} catch (error) {
  // A file that cannot be read or written (permissions, a locked file): say which, and exit non-zero.
  fail(`${error.code ?? "error"} on ${String(error.path ?? "").replace(/\\/g, "/") || "a file"}: ${error.message}`);
}
