---
name: scaffold
description: Build the Phase-0 skeleton (contracts, slice plan, verify ladder, metering) from a gate-passed foundation via the server-held scaffold prompt. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_scaffold_prompt", "mcp__plugin_devgenie_devgenie-core__get_scaffold_prompt"]
---

You are running **/devgenie:scaffold**. The methodology is delivered by the server — you fetch it and execute it.

1. **Gate check.** Decide the scope you will request (`mvp` unless the user asked for `production`), then run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" scaffold <scope>` — it requires `.devgenie/gate.json` with `verdict == PASS` and `independent == true`, checks DevGenie's signature on it, and checks the gate covers the scope you requested. Abort on non-zero.
2. **Fetch the scaffold prompt.** Call `get_scaffold_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope }`, where `scope` is exactly the scope you passed to the guard in step 1. The server returns the Phase-0 instructions for your plan. Surface any error envelope and stop. The response also carries `files[]` beside the prompt: the fixed project files (the CI workflow, `.claude/settings.json` and the metering hooks), each `{ path, content }`. Keep them. Write each entry exactly as returned, with the Write tool, create-if-absent (a path that already exists is left untouched), where the prompt says. Never retype a body the server sent.
3. **Execute exactly what the server returned** to produce `docs/SLICE_GRAPH.md`, `docs/TASK_INDEX.md`, the slice files (base each on the bundled skeleton `${CLAUDE_PLUGIN_ROOT}/templates/_TEMPLATE.slice.md`), and `scripts/verify.sh`.
4. **Wire metering.** The hooks arrive in `files[]` (step 2); make them executable and point git at them so builds are costed:
   ```
   mkdir -p .claude/hooks
   chmod +x .claude/hooks/* || true
   git config core.hooksPath .claude/hooks
   ```
5. **Record state.** Point the `CLAUDE.md` active-task pointer (`ACTIVE TASK:`) at task 1. Advance `.devgenie/state.json` `phase` to `building`. Commit: `chore: Phase 0 scaffold + metering`.
6. **Hand off.** Present what the server's prompt asks you to present, then point the user at **/devgenie:slice**.
