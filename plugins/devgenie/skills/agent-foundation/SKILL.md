---
name: agent-foundation
description: Manufacture the Tier-2 (AgentDev) foundation — <agent>.eval-spec.json and <agent>.agent-spec.json — via the server-held agent-foundation prompt, ready for the Tier-2 rating gate. Requires a passed Tier-1 intake and a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_agent_foundation_prompt", "mcp__plugin_devgenie_devgenie-core__get_agent_foundation_prompt"]
---

You are running **/devgenie:agent-foundation** — the Tier-2 (AgentDev) foundation step. The methodology is delivered by the server — you fetch it and execute it; you never invent or substitute it.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop — Tier-2 needs an active Pro or Enterprise plan.

1. **Precondition — Tier-1 intake must have passed with a signed result.** Agent-foundation refuses to manufacture specs from inputs that haven't cleared the Tier-1 intake gate. Run the guard's check, never your own reading of the marker or the `state.json` flag:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" intake-receipt
   ```
   It verifies DevGenie's signature on `.devgenie/intake.json` and accepts only PASS or CONDITIONAL. If it exits non-zero, **stop**, show its message (it names the **/devgenie:intake** re-run), then re-run `/devgenie:agent-foundation` once intake has a signed result. Do not proceed.

2. **Fetch the agent-foundation prompt.** Call the `get_agent_foundation_prompt` tool (the bundled `devgenie-core` MCP server) with `{ project_name, stack_hint?, scope? }`. The server returns the Tier-2 capture/foundation instructions, entitlement-clamped. If it returns an error envelope (`UPGRADE_REQUIRED`, `RATE_LIMITED`, `CORE_UNREACHABLE`, …), surface it plainly and stop.

3. **Execute exactly what the server returned** against `docs/inputs/` to draft `<agent>.eval-spec.json` and `<agent>.agent-spec.json` (where `<agent>` is the agent-id established by the brief). DevGenie's agent-spec validator is `${CLAUDE_PLUGIN_ROOT}/scripts/validate-agent-specs.sh`. When the prompt says to run the agent-spec validator your DevGenie skill named, run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/validate-agent-specs.sh" <agent>` with the agent id.

4. **Advance state.** Set `.devgenie/state.json` `phase` to `agent_gate_pending`. Commit: `docs: agent foundation (eval+agent spec) for Tier-2 gate`.

5. **Hand off.** Relay the served prompt's hand-off to **/devgenie:agent-gate**.
