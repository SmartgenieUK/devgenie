---
name: test
description: "Sets up and runs a project's test gate, keeps a local record of test runs, guards git commits while tests fail, and has Claude write the failing test first. Use when the developer asks to run the tests, to start test-first work in a project, or to stop commits while tests fail. DevGenie holds the practice and serves it on each run."
allowed-tools: Write mcp__devgenie-core__get_kit_files mcp__plugin_devgenie_devgenie-core__get_kit_files Bash(node *install.mjs*) Bash(node .devgenie/test-gate.mjs*)
---

# /devgenie:test

Run this only because the developer typed `/devgenie:test`. DevGenie holds this practice and serves it on each run, so this skill carries no teaching of its own.

1. Fetch the practice. Call `get_kit_files` with `practice: "test"`. If it returns `UPGRADE_REQUIRED`, `AUTH_INVALID` or `CORE_UNREACHABLE`, show its message exactly as written and stop.
2. Ask the developer whether to set this project up, before writing anything. If they decline, stop: nothing is written to the project, because the fetch only reads. If they agree, run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --check-paths <each returned path>` and stop if it exits non-zero. Write each returned `files[]` entry exactly as returned, with the Write tool, under `.devgenie/kit-incoming/test/<path>`. Then run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --kit .devgenie/kit-incoming/test`. Add `--command "<their test command>"` when the script says it found none, or `--no-hook` to skip the commit hook.
3. Follow the returned `instructions` exactly. Tell the developer in one sentence that the commit hook governs only git commits that Claude makes through its Bash tool in this project, not a commit made in a terminal or an IDE, and that it takes effect in a new session. The gate is `node .devgenie/test-gate.mjs`; the hook script is `.devgenie/test-gate-hook.mjs`.
4. To undo, run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --undo`. It removes only what the install wrote and keeps the reports.
