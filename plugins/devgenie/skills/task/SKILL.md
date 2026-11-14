---
name: task
description: Files each Claude Code session's token spend under the piece of work it belongs to. Use when the user wants to set up, change or check the active task in a project, asks what a task has cost, or says tokens are filed under the wrong work. Fetches the task kit from DevGenie, installs the session-start warning and ledger hooks into the project, and reports sessions and tokens per task.
allowed-tools: Bash(node *task.mjs *), mcp__devgenie__get_kit_files
---

# Active task pointer

Everything stays in the current project. Nothing is sent anywhere except the kit request.

## Set up (once per project)

1. Call the `get_kit_files` tool with practice `task`. If it is unavailable or refuses, show the user its message and stop.
2. Write each returned file under `.devgenie/kit/task/`, keeping its path.
3. Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" install .devgenie/kit/task` and report its output as written.
4. Follow the returned `instructions` for the rest of the work.

Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" uninstall` to remove what install added.

## Change or check the task

- Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" set <name>` to set the task, or `none`.
- Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" show` for the current task and its totals.
- Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" report` for every task's totals.

## Switch the hooks off

Run `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" off` to stop both hooks in this project, and `node "${CLAUDE_SKILL_DIR}/scripts/task.mjs" on` to resume. While they are off no ledger rows are written.

## If the script refuses

It prints one plain sentence and changes nothing. Show it to the user.
