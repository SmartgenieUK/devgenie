---
name: close
description: Closes a work session using fetched instructions and a local script. Use when a developer invokes the close command to wind down work.
disable-model-invocation: true
argument-hint: "[task]"
allowed-tools: [Read, 'Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/close.mjs" *)', "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:close

1. Call `get_kit_files` with `practice: "close"`. If it returns an error envelope, show its message as written and
   stop; run `/devgenie:setup` if the developer is not signed in.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/close.mjs" check` from the project root. If it fails, stop.
3. Follow the result's `instructions`. Pass on `$ARGUMENTS` if supplied.
4. When the instructions say `close check`, run
   `node "${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/close.mjs" check` from the project root.
5. When the instructions say `close log <task|none> <finished|unfinished> [next-task]`, run
   `node "${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/close.mjs" log <task|none> <finished|unfinished> [next-task]`
   from the project root.
