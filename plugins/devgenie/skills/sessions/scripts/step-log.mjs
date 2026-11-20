#!/usr/bin/env node
// Record the supplied step and outcome with local project attribution, through the shared records library copied beside this script.
// Nothing is enforced by this logger, so a recording problem never blocks the developer (exit 0); it is never silent either:
// every failed write prints a plain message. Only a wrong argument count exits 1, because nothing was asked to be recorded.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const args = process.argv.slice(2);
if (args.length !== 2 || args.some((v) => !v.trim())) {
  console.error("Pass a step and an outcome to step-log.mjs.");
  process.exitCode = 1;
} else if (process.env.DEVGENIE_SESSIONS !== "off" && !existsSync(join(project, ".devgenie/sessions.off"))) {
  let task = "unattributed";
  try { task = readFileSync(join(project, "CLAUDE.md"), "utf8").match(/ACTIVE TASK(?: POINTER)?:[ \t]*(\S+)/i)?.[1] ?? task; }
  catch { /* A project without a readable pointer remains unattributed. */ }
  const [step, outcome] = args;
  let appendEvent;
  try {
    ({ appendEvent } = await import(new URL("./local-records.mjs", import.meta.url).href));
  } catch {
    console.error("Step was not recorded: the DevGenie records library beside this script could not be loaded. Run /devgenie:sessions again to refresh it.");
    process.exit(0);
  }
  try {
    const result = appendEvent(project, { component: "sessions", kind: "step", data: { step, outcome, task, project: basename(project) } });
    if (!result.ok) console.error("Step was not recorded: " + result.message + (result.code === "invalid-event" ? " Steps, outcomes and task names are limited to 256 characters." : "")); // rule: fail-loud
  } catch (error) {
    console.error("Step was not recorded: " + error.message);
  }
}
