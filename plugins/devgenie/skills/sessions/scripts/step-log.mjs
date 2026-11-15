#!/usr/bin/env node
// Append the supplied step and outcome with local project attribution.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const linked = (project, name) => name.split("/").some((_, i, parts) =>
  lstatSync(join(project, ...parts.slice(0, i + 1)), { throwIfNoEntry: false })?.isSymbolicLink());

try {
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((v) => !v.trim())) {
    console.error("Pass a step and an outcome to step-log.mjs.");
    process.exitCode = 1;
  } else if (process.env.DEVGENIE_SESSIONS !== "off" && !existsSync(join(project, ".devgenie/sessions.off"))) {
    if (linked(project, ".devgenie/step-ledger.jsonl")) throw new Error();
    let task = "unattributed";
    try { task = readFileSync(join(project, "CLAUDE.md"), "utf8").match(/ACTIVE TASK(?: POINTER)?:[ \t]*(\S+)/i)?.[1] ?? task; }
    catch { /* A project without a readable pointer remains unattributed. */ }
    const [step, outcome] = args;
    mkdirSync(join(project, ".devgenie"), { recursive: true });
    appendFileSync(join(project, ".devgenie/step-ledger.jsonl"), JSON.stringify({ ts: new Date().toISOString(), step, outcome, project: basename(project), task, tokens: null }) + "\n");
  }
} catch {
  console.error("The step could not be recorded in the project.");
  process.exitCode = 1;
}
