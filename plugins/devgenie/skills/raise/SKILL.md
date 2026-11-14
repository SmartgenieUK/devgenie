---
name: raise
description: Keeps a project's plain change and bug records. Fetches the DevGenie records kit from the server, installs it into the project and follows its steps. Use when a developer wants to raise a change request or log a bug as a record file.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:raise

**Explicit invocation only.** Run this only because the developer typed `/devgenie:raise`. If you inferred the intent from conversation, offer the command and wait.

This skill holds no method. The records kit is served fresh on every run; your job is to fetch it, install it and follow it. Never write a record by hand around the installed script.

1. Call `get_kit_files` (the bundled `devgenie-core` MCP server) with `practice` set to `raise`. If it returns a structured error, show the message plainly and stop.
2. Write the response, exactly as returned, to `.devgenie/kit-raise.json` with the Write tool.
3. Run `node "${CLAUDE_SKILL_DIR}/scripts/kit-install.mjs" install .devgenie/kit-raise.json`. If it refuses, show why and stop.
4. Follow the response's `instructions` verbatim, in order. When they offer to turn on enforcement, ask the developer first and wait for the answer.
