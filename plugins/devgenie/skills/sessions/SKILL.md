---
name: sessions
description: "Installs local session records and provides report, off, on and undo commands. Use when the developer asks to set up session records in a project. DevGenie holds the practice and serves it on each run."
allowed-tools: mcp__devgenie-core__get_kit_files mcp__plugin_devgenie_devgenie-core__get_kit_files Bash(node "${CLAUDE_SKILL_DIR}/scripts/sessions.mjs" *) Bash(node .devgenie/sessions/step-log.mjs *)
---

# /devgenie:sessions

Run this only because the developer typed `/devgenie:sessions`. DevGenie holds this practice and serves it on each run, so this skill carries no teaching of its own.

1. Fetch the practice. Call `get_kit_files` with `practice: "sessions"`. On an error, show the returned message exactly as written and stop.
2. Ask the developer whether to set this project up, before writing anything. If they decline, stop: nothing is written to the project, because the fetch only reads. If they agree, run `node "${CLAUDE_SKILL_DIR}/scripts/sessions.mjs" install`.
3. Follow the returned `instructions` exactly. The installer copies `scripts/statusline.mjs`, `scripts/session-end.mjs` and `scripts/step-log.mjs` into `.devgenie/sessions/`, with a copy of the shared records library (`local-records.mjs`) beside them, and refreshes an unchanged older copy when it is run again. Start a new session for the hooks to take effect.
4. For report, off, on or undo, run `node "${CLAUDE_SKILL_DIR}/scripts/sessions.mjs" report`, replacing `report` with the requested command.
