#!/usr/bin/env node
// test-gate.mjs - the project's test gate. Installed by the /devgenie:test skill as .devgenie/test-gate.mjs.
//
// Runs the project's own test command (named in .devgenie/test-gate.json, beside this file), exits as that command does,
// and records each completed run: one JSON line in .devgenie/test-runs.jsonl and the latest in .devgenie/test-receipt.json.
// Neither holds the command's output or the command itself. It is a plain runner: it knows nothing about any test framework
// beyond reading a summary line for the counts. A run killed before it ends leaves no row.
//
// Exit codes: the command's own; 1 when the command ended by a signal or could not start; 2 when the gate is not configured
// (nothing ran, nothing is recorded); 3 when the command passed but a report could not be written.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, renameSync as renameOnce, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const root = dirname(dir);

// Two gates finishing together can make the receipt rename fail for a moment on Windows (a sharing error). Retry those a
// bounded number of times; any other error, or the last failure, is thrown unchanged.
const RENAME_TRIES = 20;
const SHARING = new Set(["EPERM", "EBUSY", "EACCES"]);
function renameSync(from, to) {
  for (let i = 1; ; i++) {
    try { return renameOnce(from, to); } catch (e) {
      if (!SHARING.has(e?.code) || i >= RENAME_TRIES) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}
const TAIL_BYTES = 64 * 1024;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Tells the commit hook, when it launched this run, what happened. Written before any report. */
function tellHook(result) {
  const p = process.env.DEVGENIE_TEST_GATE_RESULT_FILE;
  if (!p) return;
  try { writeFileSync(p, JSON.stringify(result)); } catch { /* the hook then reports that no result came back */ }
}

function notConfigured(reason) {
  tellHook({ ran: false });
  console.error(`The test gate is not set up: ${reason}. Set it up with: node "<skill folder>/scripts/install.mjs" --command "<your test command>" (the /devgenie:test skill runs install.mjs for you).`);
  process.exit(2);
}

let command;
try {
  const cfg = JSON.parse(readFileSync(join(dir, "test-gate.json"), "utf8"));
  command = cfg?.command;
} catch {
  notConfigured("test-gate.json is missing or is not valid JSON");
}
if (typeof command !== "string" || command.trim() === "") notConfigured("test-gate.json has no test command");

/** The last unambiguous summary line in the output tail, as counts; nulls when there is none. */
function parseCounts(text) {
  const ls = text.replace(ANSI, "").split(/\r?\n/);
  let best = { at: -1, passed: null, failed: null };
  const take = (at, passed, failed) => { if (at >= best.at) best = { at, passed, failed }; };
  let pass = null, fail = null;
  ls.forEach((l, i) => {
    let m = /^\s*(?:ℹ|#)\s+(pass|fail)\s+(\d+)\s*$/.exec(l);
    if (m) {
      if (m[1] === "pass") pass = { at: i, n: Number(m[2]) }; else fail = { at: i, n: Number(m[2]) };
      const at = Math.max(pass?.at ?? -1, fail?.at ?? -1);
      take(at, pass?.n ?? 0, fail?.n ?? 0);
      return;
    }
    m = /^\s*Tests:?\s+(.*(?:passed|failed).*)$/.exec(l);
    if (!m) m = /^(?:=+\s*)?((?:\d+ [a-z]+(?:, )?)+)\s+in\s+[\d.]+s/.exec(l);
    if (m) {
      const p = /(\d+) passed/.exec(m[1]);
      const f = /(\d+) failed/.exec(m[1]);
      if (p || f) take(i, p ? Number(p[1]) : 0, f ? Number(f[1]) : 0);
    }
  });
  return { passed: best.passed, failed: best.failed };
}

const started = Date.now();
let tail = Buffer.alloc(0);
let finished = false;
const keep = (chunk) => { tail = Buffer.concat([tail, chunk]); if (tail.length > TAIL_BYTES) tail = tail.subarray(tail.length - TAIL_BYTES); };

function finish(exitCode) {
  if (finished) return;
  finished = true;
  const ok = exitCode === 0;
  const counts = parseCounts(tail.toString("utf8"));
  tellHook({ ran: true, ok, exit_code: exitCode });
  const ts = new Date().toISOString();
  const duration_ms = Date.now() - started;
  let reportFailed = false;
  try {
    appendFileSync(join(dir, "test-runs.jsonl"), `${JSON.stringify({ ts, ok, passed: counts.passed, failed: counts.failed, duration_ms })}\n`);
  } catch {
    reportFailed = true;
    console.error("The test gate could not write .devgenie/test-runs.jsonl.");
  }
  try {
    const tmp = join(dir, `test-receipt.json.tmp-${process.pid}`);
    writeFileSync(tmp, `${JSON.stringify({ ts, ok, exit_code: exitCode, passed: counts.passed, failed: counts.failed, duration_ms }, null, 2)}\n`);
    renameSync(tmp, join(dir, "test-receipt.json"));
  } catch {
    reportFailed = true;
    console.error("The test gate could not write .devgenie/test-receipt.json.");
  }
  process.exit(reportFailed && ok ? 3 : exitCode);
}

const child = spawn(command, { shell: true, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (c) => { process.stdout.write(c); keep(c); });
child.stderr.on("data", (c) => { process.stderr.write(c); keep(c); });
child.on("error", (e) => { console.error(`The test gate could not start the test command: ${e.message}`); finish(1); });
child.on("close", (code) => finish(code === null ? 1 : code));
