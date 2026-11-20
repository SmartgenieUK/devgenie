// Shared local-records library: the one place DevGenie components on a developer's machine record observed history and read it back.
// Plain Node, no dependency. History goes to one append-only file per project, .devgenie/events.jsonl, one JSON object per line
// in a closed envelope: v, id, ts, component, kind, event_version, data. Nothing here leaves the machine.
//
// Writing, appendEvent(projectDir, { component, kind, eventVersion, data }, { lockWaitMs, onContended }):
//   1. The event is validated against the KINDS table and sized (8 KiB of UTF-8 including its newline) before any file is touched.
//   2. A cooperative lock is taken by creating the directory .devgenie/events.lock, retrying for lockWaitMs (default 2000 ms).
//      A lock this call did not create is never removed, and a stale lock is never stolen: a paused live writer cannot be told
//      from a dead one. A lock left behind blocks recording until someone deletes that folder by hand with every session stopped.
//   3. A link, a non-regular file, a hard-linked file, or a file whose identity changed after inspection is refused.
//   4. If an earlier writer left an unterminated tail, one separating newline is written first and the damaged bytes are kept.
//   5. The event is written in full, the descriptor closed and the lock removed, each in its own protected step.
// It returns { ok: true, id } or { ok: false, code, message } and never throws. code is one of invalid-event, too-large,
// unsafe-path, lock-busy, io-error. A failure can leave no event, a damaged fragment, or a complete event (a later step
// failed), so a caller that retries can duplicate it. Success is not a durability acknowledgement: nothing is flushed.
// The writer can wait up to lockWaitMs for the lock; individual file-system calls are not time-bounded.
//
// Reading, readEvents(projectDir) returns { rows, health }. Only complete lines are returned: an unterminated tail is withheld
// and reported, malformed and unsupported lines are counted, never dropped silently. Rows from the old per-skill files come first
// (file order), then the stream's rows (file order): the order across sources is not time order. Each row carries its source.
// The old files are only ever read, never written, copied or deleted. The reader reads the whole file as it was when opened;
// bounded streaming reads, a size warning and rotation wait for the dashboard reader.
//
// Known limit: O_NOFOLLOW covers only the last path component, so a process that can already write the project and replaces
// the .devgenie directory with a link between the check and the write is not stopped, on Windows and on POSIX alike.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_BYTES = 8192;
// KINDS[component][kind][eventVersion] is an exact payload schema: key -> list of allowed strings, or "string" (up to 256 characters).
// A producer adds its own entry, with its own exclusions: no code, prompts, file contents, transcripts, command output or credentials.
export const KINDS = { compactor: { advice: { 1: { advice: ["COMPACT", "CLEAR"] } } } };
// Old per-skill record files that are read alongside the stream. A later slice adds a row here, not a reader.
const LEGACY = [{
  file: "compactor.jsonl", component: "compactor", kind: "advice", keys: ["advice", "ts"],
  valid: (r) => typeof r.ts === "string" && (r.advice === "COMPACT" || r.advice === "CLEAR"),
  toData: (r) => ({ advice: r.advice }),
}];
const ENVELOPE = ["component", "data", "event_version", "id", "kind", "ts", "v"];
const CONTENDED = ["EEXIST", "EPERM", "EACCES", "EBUSY"];
const BAD = Symbol("malformed");
const UNSUPPORTED = Symbol("unsupported");

const fail = (code, message) => ({ ok: false, code, message });
const plain = (o) => typeof o === "object" && o !== null && !Array.isArray(o);
const sameKeys = (o, keys) => JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const schemaFor = (c, k, v) => KINDS[c]?.[k]?.[v]; // rule: kinds-table
const schemaOk = (s) => plain(s);
function payloadOk(schema, data) {
  if (!plain(data) || !sameKeys(data, Object.keys(schema))) return false;
  return Object.entries(schema).every(([key, rule]) => typeof data[key] === "string"
    && (Array.isArray(rule) ? rule.includes(data[key]) : rule === "string" && data[key].length <= 256));
}
function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function unsafeReason(st, wantDirectory) {
  if (st.isSymbolicLink()) return "is a link";
  if (wantDirectory) return st.isDirectory() ? null : "is not a directory";
  if (!st.isFile()) return "is not a regular file";
  if (st.nlink > 1) return "has more than one hard link";
  return null;
}
const unsafe = (st, wantDirectory) => unsafeReason(st, wantDirectory); // rule: link-refusal
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function acquire(lockPath, lockWaitMs, onContended) {
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return { ok: true, owned: true };
    } catch (error) {
      if (!CONTENDED.includes(error.code)) return fail("io-error", `Could not create the lock folder ${lockPath}: ${error.message}`);
      /* rule: no-stealing */
      if (typeof onContended === "function") onContended();
      if (Date.now() >= deadline) break; // rule: retry-until-deadline
      sleep(5 + Math.floor(Math.random() * 20));
    }
  }
  return fail("lock-busy", `Another recording holds the lock folder ${lockPath}. If no DevGenie session is running, delete that folder by hand and try again.`);
}
function release(held, lockPath) {
  if (!held.owned) return null;
  try { fs.rmdirSync(lockPath); return null; } catch (error) {
    return fail("io-error", `The event was written but the lock folder ${lockPath} could not be removed: ${error.message}`);
  }
}
function prepareDirectory(dir) {
  let st = lstatOrNull(dir);
  if (!st) {
    try { fs.mkdirSync(dir); } catch (error) { if (error.code !== "EEXIST") throw error; }
    st = lstatOrNull(dir);
  }
  const reason = st ? unsafe(st, true) : "could not be created";
  return reason ? fail("unsafe-path", `Cannot record: ${dir} ${reason}.`) : null;
}
function writeLocked(dir, buffer, id) {
  const file = path.join(dir, "events.jsonl");
  const st = lstatOrNull(file);
  const reason = st ? unsafe(st, false) : null;
  if (reason) return fail("unsafe-path", `Cannot record: ${file} ${reason}.`);
  let fd;
  let outcome;
  let closeError = null;
  try {
    // An existing file is opened without O_CREAT so a swapped link cannot create a missing outside target; a new file is created exclusively.
    fd = fs.openSync(file, st ? fs.constants.O_RDWR | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0) : "ax");
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || (st && (opened.dev !== st.dev || opened.ino !== st.ino))) {
      outcome = fail("unsafe-path", `Cannot record: ${file} changed after inspection.`);
    } else {
      if (opened.size > 0) {
        const tail = Buffer.alloc(1);
        fs.readSync(fd, tail, 0, 1, opened.size - 1);
        const last = tail[0];
        if (last !== 10) fs.writeSync(fd, "\n"); // rule: separate-tail
      }
      let offset = 0;
      while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
      outcome = { ok: true, id };
    }
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (error) { closeError = error; } }
  }
  return closeError ? fail("io-error", `The event was written but ${file} could not be closed: ${closeError.message}`) : outcome;
}

export function appendEvent(projectDir, event, options) {
  let result;
  try {
    const { component, kind, eventVersion = 1, data } = event ?? {};
    const { lockWaitMs = 2000, onContended } = options ?? {};
    const schema = typeof component === "string" && typeof kind === "string" ? schemaFor(component, kind, eventVersion) : undefined;
    if (!Number.isInteger(eventVersion) || eventVersion < 1 || !schemaOk(schema) || !payloadOk(schema, data)) {
      return fail("invalid-event", "The event is not one this version of DevGenie can record.");
    }
    const envelope = {
      v: 1,
      id: crypto.randomUUID(), // rule: unique-id
      ts: new Date().toISOString(),
      component,
      kind,
      event_version: eventVersion,
      data,
    };
    const line = JSON.stringify(envelope) + "\n";
    const size = Buffer.byteLength(line); // rule: cap-bytes
    if (size > MAX_BYTES) return fail("too-large", "The event is larger than the 8 KiB limit."); // rule: cap-enforced
    const dir = path.join(projectDir, ".devgenie");
    const refused = prepareDirectory(dir);
    if (refused) return refused;
    const lockPath = path.join(dir, "events.lock");
    const held = acquire(lockPath, lockWaitMs, onContended); // rule: take-lock
    if (!held.ok) return held;
    try {
      result = writeLocked(dir, Buffer.from(line, "utf8"), envelope.id);
      /* rule: legacy-untouched */
    } finally {
      const released = release(held, lockPath); // rule: release-lock
      if (released) result = released;
    }
    return result;
  } catch (error) {
    return { ok: false, code: "io-error", message: `Could not record the event: ${error.message}` }; // rule: never-throw
  }
}

function parseEvent(line) {
  if (Buffer.byteLength(line) + 1 > MAX_BYTES) return BAD;
  let o;
  try { o = JSON.parse(line); } catch { return BAD; }
  if (!plain(o) || !sameKeys(o, ENVELOPE) || typeof o.v !== "number" || typeof o.id !== "string" || typeof o.ts !== "string"
    || typeof o.component !== "string" || typeof o.kind !== "string" || !Number.isInteger(o.event_version) || o.event_version < 1 || !plain(o.data)) return BAD;
  if (o.v !== 1) return UNSUPPORTED;
  const schema = schemaFor(o.component, o.kind, o.event_version);
  if (!schemaOk(schema)) return UNSUPPORTED;
  if (!payloadOk(schema, o.data)) return BAD;
  return { source: "events.jsonl", v: o.v, id: o.id, ts: o.ts, component: o.component, kind: o.kind, event_version: o.event_version, data: o.data };
}
function legacyParser(entry) {
  return (line) => {
    if (Buffer.byteLength(line) + 1 > MAX_BYTES) return BAD;
    let o;
    try { o = JSON.parse(line); } catch { return BAD; }
    if (!plain(o) || !sameKeys(o, entry.keys) || !entry.valid(o)) return BAD;
    return { source: entry.file, ts: o.ts, component: entry.component, kind: entry.kind, data: entry.toData(o) };
  };
}
function scan(dir, dirReason, name, parseLine) {
  const health = { state: "ok", malformed: 0, unsupported: 0, incompleteTail: false };
  const out = [];
  const file = path.join(dir, name);
  const bad = () => { health.malformed += 1; }; // rule: count-malformed
  const unreadable = (reason) => { health.state = "unreadable"; health.reason = reason; return { health, out }; };
  if (dirReason) return unreadable(`${dir} ${dirReason}.`);
  const st = lstatOrNull(file);
  if (!st) { health.state = "missing"; return { health, out }; }
  const reason = unsafe(st, false);
  if (reason) return unreadable(`${file} ${reason}.`);
  let text;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== st.dev || opened.ino !== st.ino) return unreadable(`${file} changed while it was being read.`);
    const buffer = Buffer.alloc(opened.size);
    let got = 0;
    while (got < buffer.length) {
      const n = fs.readSync(fd, buffer, got, buffer.length - got, got);
      if (n === 0) break;
      got += n;
    }
    text = buffer.subarray(0, got).toString("utf8");
  } finally { fs.closeSync(fd); }
  const lastNl = text.lastIndexOf("\n");
  const complete = text.slice(0, lastNl + 1); // rule: complete-lines-only
  health.incompleteTail = text.length > lastNl + 1;
  const lines = complete.split("\n");
  if (complete.endsWith("\n")) lines.pop();
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === BAD) bad();
    else if (parsed === UNSUPPORTED) health.unsupported += 1;
    else out.push(parsed);
  }
  return { health, out };
}

export function readEvents(projectDir) {
  try {
    const dir = path.join(projectDir, ".devgenie");
    const st = lstatOrNull(dir);
    const dirReason = st ? unsafe(st, true) : null;
    const rows = [];
    const health = {};
    const legacyRows = [];
    for (const entry of LEGACY) {
      const r = scan(dir, dirReason, entry.file, legacyParser(entry));
      health[entry.file] = r.health;
      legacyRows.push(...r.out);
    }
    const stream = scan(dir, dirReason, "events.jsonl", parseEvent);
    health["events.jsonl"] = stream.health;
    rows.push(...legacyRows); // rule: legacy-once
    rows.push(...stream.out);
    return { rows, health };
  } catch (error) {
    return { rows: [], health: { "events.jsonl": { state: "unreadable", reason: `Could not read the records: ${error.message}`, malformed: 0, unsupported: 0, incompleteTail: false } } };
  }
}
