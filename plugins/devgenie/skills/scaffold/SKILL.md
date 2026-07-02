---
name: scaffold
description: Build the Phase-0 skeleton (contracts, slice plan, verify ladder, metering) from a gate-passed foundation via the server-held scaffold prompt. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_scaffold_prompt", "mcp__plugin_devgenie_devgenie-core__get_scaffold_prompt"]
---

You are running **/devgenie:scaffold**. The methodology is delivered by the server — you fetch it and execute it.

1. **Gate check.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" scaffold` — it requires `.devgenie/gate.json` with `verdict == PASS` and `independent == true`. Abort on non-zero.
2. **Fetch the scaffold prompt.** Call `get_scaffold_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope? }`. The server returns the Phase-0 instructions clamped to your depth scope (`mvp` for Lite; `+production` for Pro). Surface any error envelope and stop.
3. **Execute exactly what the server returned** to produce `docs/SLICE_GRAPH.md`, `docs/TASK_INDEX.md`, the slice files (base each on the bundled skeleton `${CLAUDE_PLUGIN_ROOT}/templates/_TEMPLATE.slice.md`), and `scripts/verify.sh`. Write no business logic. Emit `slice-00-preconditions` first.
4. **Install metering.** Wire the local token ledger so builds are costed:
   ```
   mkdir -p .claude/hooks
   cp "${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/record-tokens.sh" .claude/hooks/
   cp "${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/prepare-commit-msg" .claude/hooks/
   cp "${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/settings.json" .claude/settings.json
   chmod +x .claude/hooks/* || true
   git config core.hooksPath .claude/hooks
   ```
5. **Stop for approval.** Point the `CLAUDE.md` active-task pointer (`ACTIVE TASK:`) at task 1, present the plan, and **STOP** — do not start slice 1. Advance `.devgenie/state.json` `phase` to `building`. Commit: `chore: Phase 0 scaffold + metering`.
6. **Hand off.** Tell the user to run **/devgenie:slice** — one task per fresh session.
