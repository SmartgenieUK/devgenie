---
name: cac
description: "Sets up project change admission from a served kit and follows its instructions. Use when a developer explicitly invokes the change admission skill to set up or use the local check."
disable-model-invocation: true
allowed-tools: Write mcp__devgenie-core__get_kit_files mcp__plugin_devgenie_devgenie-core__get_kit_files Bash(node *install.mjs*) Bash(node .devgenie/cac-check.mjs*)
---

# /devgenie:cac

Explicit invocation only: run because the developer typed `/devgenie:cac`. Otherwise offer the command and wait. This front door fetches, installs and follows the served practice.

1. Call `get_kit_files` with `practice: "cac"`. Show any structured error exactly as returned and stop.
2. Ask the developer whether to set up this project before staging anything. If they decline, stop: nothing is written. Wait for consent before using the Write tool.
3. Run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --check-paths <each returned path>`; stop on refusal. Stage each returned file exactly with the Write tool under `.devgenie/kit-incoming/cac/<path>`.
4. Run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --kit .devgenie/kit-incoming/cac`; add `--no-hook` if the developer declines Bash wiring. The installer copies the handed checker and cac-hook.mjs into the project.
5. Follow the returned `instructions` exactly. The standalone entry is `node .devgenie/cac-check.mjs --message "<text>"`. The hook governs only git commits Claude makes through its Bash tool in this project; terminal and IDE commits are outside its scope. It takes effect in a new Claude Code session.
6. Run `node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --undo` to remove owned unchanged outputs and the owned handler, keeping developer edits and the journal.
