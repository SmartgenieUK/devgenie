---
name: agent-slice
description: Run one turn of the Tier-2 (AgentDev) build loop for one agent via the server-held agent-slice prompt — run the eval, submit the evidence for a server-side verdict, log it, and revise the prompt as a new version only on approval. One turn per fresh session. Requires a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, Edit, EnterPlanMode, ExitPlanMode, "mcp__devgenie-core__get_agent_slice_prompt", "mcp__plugin_devgenie_devgenie-core__get_agent_slice_prompt", "mcp__devgenie-core__judge_eval_run", "mcp__plugin_devgenie_devgenie-core__judge_eval_run"]
---

You are running **/devgenie:agent-slice** — one turn of the Tier-2 (AgentDev) build loop. One turn per fresh session (clean attribution). This skill holds no methodology: it is delivered by the server — you fetch it and execute it; you never invent or substitute it.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop.

1. **Gate check.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-slice` — abort on non-zero and route the user to `/devgenie:agent-scaffold`.
2. **Fetch the agent-slice prompt.** Call `get_agent_slice_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope? }`. If it returns an error envelope, surface it plainly and stop.
3. **Execute exactly what the server returned.** The eval runner only runs; the verdict comes from `judge_eval_run`. Take the verdict as given — never compute a pass/fail, a threshold or a scoring rule yourself, and never write one into the repo.
   - **Crown-jewel rule (non-negotiable):** prompt text lives only in the versioned prompt file — never in `<agent>.agent-spec.json` or the eval-run-log.
4. **Write nothing outside the approved plan**, and stop when the turn is done. The next turn is a new fresh session.
