---
name: coarch
description: Starts this session as the architect window of two-window working, fetching the role's instructions and the brief starter files from DevGenie and installing the starters in the project. Use when a developer wants to plan a change, write or issue a brief, or review a returned brief.
disable-model-invocation: true
argument-hint: "[what you want to work on]"
allowed-tools: [Read, Write, 'Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" *)', "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:coarch

This skill holds no instructions of its own. It fetches them from DevGenie, installs the starter files they come
with, and hands the session over to them.

1. Call `get_kit_files` (the bundled `devgenie-core` MCP server) with `practice: "coarch"`. If it returns an error
   envelope (`AUTH_INVALID`, `UPGRADE_REQUIRED`, `CORE_UNREACHABLE` and the like), show its message as written and
   stop; run `/devgenie:setup` if the developer is not signed in.
2. Save the whole result, exactly as returned, to `.devgenie/kit/coarch.json` in the project with the Write tool.
   Never retype or edit a body.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" install .devgenie/kit/coarch.json` from the
   project root. It writes each file the kit names that is not there yet, keeps existing files, and prints what it
   did. Tell the developer if it created anything.
4. Follow the result's `instructions` for the rest of this session; they define the role. If the developer gave a
   topic with the command (`$ARGUMENTS`), pass it on as the first thing to work on.
5. When the instructions say `briefs set <brief> <status>`, run
   `node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" set <brief> <status>` from the project root.

To take the starter files out again, run
`node "${CLAUDE_PLUGIN_ROOT}/skills/coarch/scripts/briefs.mjs" remove .devgenie/kit/coarch.json`: it deletes only
files that are still exactly as installed.
