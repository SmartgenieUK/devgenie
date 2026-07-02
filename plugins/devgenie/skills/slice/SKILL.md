---
name: slice
description: Build one task/slice end-to-end via the server-held slice prompt — plan, approve, build, verify, one commit. One per fresh session. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, Edit, "mcp__devgenie-core__get_slice_prompt", "mcp__plugin_devgenie_devgenie-core__get_slice_prompt"]
---

You are running **/devgenie:slice** — build one slice, one PR. One task per fresh session (clean token attribution).

1. **Definition of Ready.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" slice` — abort on non-zero.
2. **Pick the task.** Read the next `pending` task from `docs/TASK_INDEX.md`; set the `CLAUDE.md` active-task pointer (`ACTIVE TASK:`) to its slug — the metering hook reads this to attribute the spend.
3. **Fetch the slice prompt.** Call `get_slice_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope? }`. Surface any error envelope and stop.
4. **Plan first.** Following the returned instructions, produce a file manifest (create / modify / delete) scoped to the slice's "Touch only" list. Present it (ExitPlanMode or an explicit confirm) and **write nothing until the user approves**.
5. **Build, then verify.** Implement the approved plan, then run `bash scripts/verify.sh`. Do **not** commit if verify fails.
6. **Commit one task / one PR.** Mark the task `done` in `docs/TASK_INDEX.md`. The bundled hooks meter the tokens automatically on commit / session end. Stop — the next slice is a new fresh session.
