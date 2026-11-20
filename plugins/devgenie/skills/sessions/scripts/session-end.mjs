#!/usr/bin/env node
// Best-effort transcript timing, recorded through the shared records library copied beside this script (local-records.mjs).
// It never blocks a session (always exit 0) and never fails quietly: a failed write prints a plain message on stderr every
// time, though Claude Code may not show a session-end hook's output to the developer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
    if (stamps.length) {
      const start = stamps[0], end = stamps.at(-1);
      const duration = (Date.parse(end) - Date.parse(start)) / 1000;
      let appendEvent;
      try {
        ({ appendEvent } = await import(new URL("./local-records.mjs", import.meta.url).href));
      } catch {
        console.error("Session was not recorded: the DevGenie records library beside this script could not be loaded. Run /devgenie:sessions again to refresh it.");
        process.exit(0);
      }
      const result = appendEvent(project, { component: "sessions", kind: "session", data: { session: input.session_id, start, end, duration_s: duration } });
      if (!result.ok) console.error("Session was not recorded: " + result.message);
    }
  }
} catch { /* SessionEnd is fail-open for malformed input and local I/O errors. */ }
