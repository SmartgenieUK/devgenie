---
name: agent-scaffold
description: Stand up the Tier-2 (AgentDev) Phase-0 scaffold — tool-definition stubs, the prompt skeleton v1.0 and a dumb eval runner — via the server-held agent-scaffold prompt, from a foundation that has PASSED the independent Tier-2 gate. Requires a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_agent_scaffold_prompt", "mcp__plugin_devgenie_devgenie-core__get_agent_scaffold_prompt", "mcp__devgenie-core__scaffold_agent", "mcp__plugin_devgenie_devgenie-core__scaffold_agent", "mcp__devgenie-core__get_template", "mcp__plugin_devgenie_devgenie-core__get_template"]
---

You are running **/devgenie:agent-scaffold** — the Tier-2 (AgentDev) Phase-0 scaffold. This skill holds no methodology: it is delivered by the server — you fetch it and execute it; you never invent or substitute it.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop.

1. **Fetch the agent-scaffold prompt.** Call `get_agent_scaffold_prompt` (the bundled `devgenie-core` MCP server) with `{ project_name, scope? }`. If it returns an error envelope, surface it plainly and stop.
2. **Execute exactly what the server returned.** It drives the server tools (`scaffold_agent`, `get_template`) and tells you what to write and when to stop; write their output exactly as returned.
