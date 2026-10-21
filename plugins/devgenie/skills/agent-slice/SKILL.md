---
name: agent-slice
description: Run one turn of the Tier-2 (AgentDev) build loop for one agent via the server-held agent-slice prompt. Requires a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, Edit, EnterPlanMode, ExitPlanMode, "mcp__devgenie-core__get_agent_slice_prompt", "mcp__plugin_devgenie_devgenie-core__get_agent_slice_prompt", "mcp__devgenie-core__judge_eval_run", "mcp__plugin_devgenie_devgenie-core__judge_eval_run"]
---

You are running **/devgenie:agent-slice** — one turn of the Tier-2 (AgentDev) build loop. This skill holds no methodology: it is delivered by the server — you fetch it and execute it; you never invent or substitute it.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop.

1. **Fetch the agent-slice prompt.** Call `get_agent_slice_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope? }`. If it returns an error envelope, surface it plainly and stop.
2. **Execute exactly what the server returned**, including where it tells you to stop.
