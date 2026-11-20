// evidence-report.mjs: the evidence gate's local refusals report, installed by the /devgenie:evidence skill.
// The gate decides; this file only records what it is told. One JSON line per refused write in
// .devgenie/evidence-refusals.jsonl: { ts, file, check, retry_passed }. No file content. Nothing leaves the machine.

import fs from "node:fs";
import path from "node:path";

const REPORT = ".devgenie/evidence-refusals.jsonl"; // the report, relative to the project root
const LOCK_TRIES = 100; // tries to take the report's lock before giving up
const LOCK_PAUSE_MS = 20; // pause between tries, so about two seconds at most
const LOCK_STALE_MS = 10000; // a lock this old was left by a hook that died

/** Runs fn holding a lock file beside the report, so two hooks running at once never lose each other's row. When the
 *  lock cannot be got in time it throws and does nothing: an update never runs unlocked, and a lock that is not ours is
 *  never removed. The caller keeps its decision either way, and a row not marked stays as it was. */
function locked(report, fn) {
  const lock = `${report}.lock`;
  for (let i = 0; i < LOCK_TRIES; i++) {
    try { fs.closeSync(fs.openSync(lock, "wx")); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true }); } catch { /* gone already */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_PAUSE_MS);
      continue;
    }
    try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
  }
  throw new Error("the refusals report is busy");
}

/** Appends one refusal row. Throws on a write failure; the caller keeps its decision either way. */
export function logRefusal(root, file, check) {
  const report = path.join(root, REPORT);
  fs.mkdirSync(path.dirname(report), { recursive: true });
  locked(report, () => fs.appendFileSync(report, JSON.stringify({ ts: new Date().toISOString(), file, check, retry_passed: false }) + "\n"));
}

/** The newest row for this file, if it is still retry_passed false, now records that a later write landed. */
export function markRetryPassed(root, file) {
  const report = path.join(root, REPORT);
  locked(report, () => {
    let lines;
    try { lines = fs.readFileSync(report, "utf8").split(/\r?\n/).filter(Boolean); } catch { return; }
    for (let i = lines.length - 1; i >= 0; i--) {
      let row;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      if (row?.file !== file) continue;
      if (row.retry_passed !== false) return;
      row.retry_passed = true;
      lines[i] = JSON.stringify(row);
      const temp = `${report}.${process.pid}.tmp`;
      fs.writeFileSync(temp, lines.join("\n") + "\n");
      fs.renameSync(temp, report); // replaced whole, never left half-written
      return;
    }
  });
}
