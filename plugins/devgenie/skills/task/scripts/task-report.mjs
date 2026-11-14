// task-report.mjs - the per-task report, derived from the project's token ledger.
//
// The ledger (metrics/token-ledger.jsonl) holds one JSON row per finished session, each carrying the task the
// ACTIVE TASK line named at that moment. This module totals those rows per task and writes the result to
// .devgenie/tasks.jsonl, one line per task: { task, sessions, total_billed, first_ts, last_ts }.
// It is rebuilt from the ledger every time, so it cannot drift. It holds counts and token totals only, and
// nothing in it leaves the machine.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The one pattern every consumer uses to read the pointer: the first match in CLAUDE.md wins. */
// The value must start on the same line as the label, as it does for the shell ledger hook's line-based grep.
export const POINTER_RE = /ACTIVE TASK( POINTER)?:[ \t]*(\S+)/i;

/** The off switch: DEVGENIE_TASK_POINTER=off in the environment, or the file .devgenie/task-pointer.off in the project. */
export function isOff(dir) {
  return process.env.DEVGENIE_TASK_POINTER === "off" || existsSync(join(dir, ".devgenie", "task-pointer.off"));
}

/** The task named by the first ACTIVE TASK line in the project's CLAUDE.md, or null when there is none. */
export function readPointer(dir) {
  try {
    const m = readFileSync(join(dir, "CLAUDE.md"), "utf8").match(POINTER_RE);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

/**
 * Ledger text in, one total per task out, in the order each task first appears. Within one session, each row is
 * cumulative (a resumed session re-reads its whole transcript), so rows are ordered by row time within each session
 * and each row is credited only with the tokens added since that session's previous row, whatever task it was under.
 * Unreadable or invalid lines are skipped and counted in the result's `skipped` property.
 */
export function buildReport(ledgerText) {
  let skipped = 0;
  const bySession = new Map(); // session key -> [{ row, idx }]; rows with no session id each stand alone
  const byTask = new Map();
  let anon = 0;
  let idx = 0;
  for (const line of ledgerText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const billed = row?.tokens?.total_billed;
    if (!row || typeof row.task !== "string" || !row.task || !Number.isFinite(billed) || billed < 0) {
      skipped += 1;
      continue;
    }
    if (!byTask.has(row.task)) {
      byTask.set(row.task, { task: row.task, sessions: 0, total_billed: 0, first_ts: null, last_ts: null });
    }
    const key = typeof row.session === "string" && row.session ? `s\u0000${row.session}` : `anon${anon++}`;
    let rows = bySession.get(key);
    if (!rows) {
      rows = [];
      bySession.set(key, rows);
    }
    rows.push({ row, idx: idx++ });
  }
  for (const rows of bySession.values()) {
    rows.sort((a, b) => {
      const ta = typeof a.row.ts === "string" ? a.row.ts : "";
      const tb = typeof b.row.ts === "string" ? b.row.ts : "";
      return ta < tb ? -1 : ta > tb ? 1 : a.idx - b.idx;
    });
    let prev = 0;
    const seenTasks = new Set();
    for (const { row } of rows) {
      const billed = row.tokens.total_billed;
      const delta = Math.max(0, billed - prev);
      prev = billed;
      const t = byTask.get(row.task);
      if (!seenTasks.has(row.task)) {
        seenTasks.add(row.task);
        t.sessions += 1;
      }
      t.total_billed += delta;
      if (typeof row.ts === "string") {
        if (!t.first_ts || row.ts < t.first_ts) t.first_ts = row.ts;
        if (!t.last_ts || row.ts > t.last_ts) t.last_ts = row.ts;
      }
    }
  }
  const out = [...byTask.values()];
  out.skipped = skipped;
  return out;
}

/** Rebuild .devgenie/tasks.jsonl from the ledger. With no ledger it writes nothing. Returns the totals. */
export function writeReport(dir) {
  let text;
  try {
    text = readFileSync(join(dir, "metrics", "token-ledger.jsonl"), "utf8");
  } catch {
    return [];
  }
  const report = buildReport(text);
  mkdirSync(join(dir, ".devgenie"), { recursive: true });
  writeFileSync(join(dir, ".devgenie", "tasks.jsonl"), report.map((r) => JSON.stringify(r)).join("\n") + (report.length ? "\n" : ""));
  return report;
}

// Run directly (the ledger hook calls this after it appends a row): rebuild the report for the project in argv[2].
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    writeReport(process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  } catch {
    /* the report is best effort: a failure here must never touch the session */
  }
}
