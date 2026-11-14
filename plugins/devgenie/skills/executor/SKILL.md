---
name: executor
description: Starts this session as the builder window of two-window working, fetching the role's instructions from DevGenie and then building one issued brief from docs/briefs/. Use when a developer has an issued brief to build, or asks this session to build, resume or re-read a brief.
disable-model-invocation: true
argument-hint: "[brief, for example 003-add-login]"
allowed-tools: [Read, 'Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" *)', "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:executor

This skill holds no instructions of its own. It fetches them from DevGenie and hands the session over to them.

1. Call `get_kit_files` (the bundled `devgenie-core` MCP server) with `practice: "executor"`. If it returns an error
   envelope (`AUTH_INVALID`, `UPGRADE_REQUIRED`, `CORE_UNREACHABLE` and the like), show its message as written and
   stop; run `/devgenie:setup` if the developer is not signed in.
2. Follow the result's `instructions` for the rest of this session; they define the role. If the developer named a
   brief with the command (`$ARGUMENTS`), that is the brief to build.
3. When the instructions say `briefs set <brief> <status>`, run
   `node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" set <brief> <status>` from the project root.
