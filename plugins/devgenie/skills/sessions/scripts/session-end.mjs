#!/usr/bin/env node
// Best-effort transcript timing; a failed append must never fail the session.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const linked = (project, name) => name.split("/").some((_, i, parts) =>
  lstatSync(join(project, ...parts.slice(0, i + 1)), { throwIfNoEntry: false })?.isSymbolicLink());

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const project = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  if (process.env.DEVGENIE_SESSIONS !== "off" && !existsSync(join(project, ".devgenie/sessions.off")) &&
      typeof input?.session_id === "string" && input.session_id && typeof input.transcript_path === "string") {
    const stamps = readFileSync(input.transcript_path, "utf8").split(/\r?\n/).flatMap((line) => {
      try {
        const stamp = JSON.parse(line)?.timestamp;
        return typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? [stamp] : [];
      } catch { return []; }
    });
    if (stamps.length && !linked(project, ".devgenie/sessions.jsonl")) {
      const start = stamps[0], end = stamps.at(-1);
      const duration = (Date.parse(end) - Date.parse(start)) / 1000;
      mkdirSync(join(project, ".devgenie"), { recursive: true });
      appendFileSync(join(project, ".devgenie/sessions.jsonl"), JSON.stringify({ ts: new Date().toISOString(), session: input.session_id, start, end, duration_s: duration }) + "\n");
    }
  }
} catch { /* SessionEnd is fail-open for malformed input and local I/O errors. */ }
