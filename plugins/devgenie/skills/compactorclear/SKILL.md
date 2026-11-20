---
name: compactorclear
description: Fetches served compact-or-clear advice and records one advice word in the project log. Use when a developer asks for compact-or-clear advice.
disable-model-invocation: true
allowed-tools: [Read, 'Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/compactorclear/scripts/log.mjs" *)', "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:compactorclear

**Explicit invocation only.** Run this only because the developer typed `/devgenie:compactorclear`. If the intent was inferred, offer the command and wait.

This skill holds no method. Fetch the served instructions on each invocation and follow them.

The developer types `/compact` or `/clear`. Never run `/compact` or `/clear` on the developer's behalf.

1. Call `get_kit_files` with `practice: "compactor"`. If it returns a structured error, show its message plainly and stop.

2. Follow the response's `instructions` verbatim, in order.

3. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/compactorclear/scripts/log.mjs" <advice>` from the project root, replacing `<advice>` with exactly `COMPACT` or `CLEAR` as given by the served instructions. This fulfils the served method's final logging step once; it is not a second invocation. If the script prints a message, it could not record the advice: show that message plainly every time; the advice itself still stands.
