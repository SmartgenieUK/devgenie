---
name: update
description: Updates the DevGenie plugin through the Claude Code command line and shows the release notes for each version it moved through. Use when a developer invokes the update command to bring DevGenie up to date.
disable-model-invocation: true
allowed-tools: ['Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/update/scripts/update.mjs")']
---

# /devgenie:update

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/update/scripts/update.mjs"` with Bash.
2. Show the developer its output exactly as printed, then stop. Do not run any other command to update DevGenie, and
   say nothing about the result that the output does not say.
