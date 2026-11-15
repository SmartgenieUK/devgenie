#!/usr/bin/env node
// Local mechanics: inspect a project or append a supplied close record, using the sibling task setter when requested.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const taskScript = resolve(dirname(fileURLToPath(import.meta.url)), "../../task/scripts/task.mjs");
const namePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
let pointerChanged = false;

function fail(message) {
  console.error(`close: ${message.replace(/[\r\n]+/g, " ")}`);
  process.exit(1);
}

function refuse(message) {
  throw new Error(message);
}

function activeTask() {
  let text;
  try { text = readFileSync(join(project, "CLAUDE.md"), "utf8"); }
  catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  return /ACTIVE TASK( POINTER)?:[ \t]*(\S+)/i.exec(text)?.[2] ?? null;
}

function statusSnapshot() {
  const result = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: project, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8", timeout: 3000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code === "ENOENT" ? "Git is missing or not available."
      : /not a git repository/i.test(result.stderr ?? "") ? "Not a Git repository."
      : "Git status is unavailable or timed out.";
    return { count: null, paths: [], reason };
  }
  const records = result.stdout.split("\0"), paths = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    paths.push(record.slice(3));
    // NUL porcelain puts the destination first and gives a rename or copy a second, source record.
    if (/[RC]/.test(record.slice(0, 2))) i++;
  }
  return { count: paths.length, paths };
}

function showStatus(status) {
  if (status.count === null) console.log(`Uncommitted status unavailable: ${status.reason}`);
  else {
    console.log(`Uncommitted entries: ${status.count}`);
    for (const path of status.paths.slice(0, 5)) console.log(`  ${path}`);
  }
}

function insideProject(target) {
  const root = realpathSync(project);
  let probe = target, info;
  for (;;) {
    try { info = lstatSync(probe); break; }
    catch (e) {
      if (e.code !== "ENOENT") throw e;
      probe = dirname(probe);
    }
  }
  if (probe === target && info.isSymbolicLink()) refuse("Refused a linked close log path in the project.");
  const real = realpathSync(probe);
  if (real !== root && !real.startsWith(root + sep)) refuse("Refused a close log path outside the project.");
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    if (args.length) refuse("Use check without arguments.");
  } else if (command === "log") {
    if (args.length < 2 || args.length > 3) refuse("Use log <task|none> <finished|unfinished> [next-task].");
    if (!namePattern.test(args[0]) || (args.length === 3 && !namePattern.test(args[2]))) {
      refuse("Task names must start with a lower-case letter or digit and contain at most 64 lower-case letters, digits, dots, underscores or hyphens.");
    }
    if (!["finished", "unfinished"].includes(args[1])) refuse("The status must be finished or unfinished.");
    if (args[1] === "unfinished" && args.length === 3) refuse("Unfinished work cannot supply a next task.");
  } else refuse("Use check or log <task|none> <finished|unfinished> [next-task].");

  const logPath = join(project, ".devgenie", "closes.jsonl");
  if (command === "log") insideProject(logPath);
  const active = activeTask();
  const installed = existsSync(taskScript) && active !== null;
  const status = statusSnapshot();
  console.log(active === null ? "No active task." : `Active task: ${active}`);
  console.log(`Task practice installed: ${installed ? "yes" : "no"}`);
  showStatus(status);
  if (command === "check") return;

  const [task, state, nextTask] = args;
  const finished = state === "finished";
  if (finished && nextTask !== undefined && installed) {
    insideProject(join(project, "CLAUDE.md"));
    const result = spawnSync(process.execPath, [taskScript, "set", nextTask], {
      cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      encoding: "utf8", timeout: 3000, windowsHide: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) refuse("Task set failed; no close row was written.");
    pointerChanged = true;
  }
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify({
    ts: new Date().toISOString(), task, finished,
    uncommitted: status.count, task_practice: installed,
  }) + "\n", "utf8");
  console.log(`Recorded close for ${task} in .devgenie/closes.jsonl.`);
}

try { main(); }
catch (e) {
  fail(`${e.message}${pointerChanged ? " The task pointer may already have changed; the close row could not be written." : ""}`);
}
