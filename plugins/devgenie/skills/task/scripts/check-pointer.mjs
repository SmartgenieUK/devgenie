#!/usr/bin/env node
// check-pointer.mjs - SessionStart hook: tells you where this session's tokens will be filed.
//
// CLAUDE.md carries one line, "ACTIVE TASK: <name>". The token-ledger hook files every finished session under
// that name. A missing or stale name files spend under the wrong work without any error, so this hook says so
// at the start of the session. It only advises: it prints to stdout and always exits 0, so it can never stop a
// session from starting. It also rebuilds the per-task report, best effort.
import { isOff, readPointer, writeReport } from "./task-report.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const say = (m) => process.stdout.write(`${m}\n`);

if (isOff(dir)) process.exit(0); // switched off: say nothing, touch nothing

// The task of the most recent ledger row: where the previous session was filed.
function lastLedgerTask() {
  try {
    const lines = readFileSync(join(dir, "metrics", "token-ledger.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    return lines.length ? (JSON.parse(lines[lines.length - 1]).task ?? null) : null;
  } catch {
    return null;
  }
}

try {
  const report = (() => {
    try {
      return writeReport(dir);
    } catch {
      return [];
    }
  })();
  const task = readPointer(dir);

  if (task === null) {
    say("warning: CLAUDE.md has no 'ACTIVE TASK:' line, so this session's tokens will be filed under 'none'.");
    say("    Run /devgenie:task install, or add the line yourself.");
  } else if (task.toLowerCase() === "none") {
    say("ACTIVE TASK: none. Set it before real work (/devgenie:task set <name>), or this session's tokens are filed under 'none'.");
  } else {
    const so_far = report.find((r) => r.task === task);
    const totals = so_far ? ` (${so_far.sessions} session${so_far.sessions === 1 ? "" : "s"}, ${so_far.total_billed.toLocaleString("en-GB")} tokens so far)` : " (no sessions filed yet)";
    say(`ACTIVE TASK: ${task}${totals}`);
    if (lastLedgerTask() === task) {
      say(`warning: carried over. The previous session was also filed under '${task}'. If that work is finished, set the task to a new name or 'none'; otherwise this session's tokens are filed under it too.`);
    }
  }
} catch (err) {
  say(`warning: the task pointer check failed (${err.message}); the session is not affected.`);
}
process.exit(0);
