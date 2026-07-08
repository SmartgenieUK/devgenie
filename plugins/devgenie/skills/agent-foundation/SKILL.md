---
name: agent-foundation
description: Manufacture the Tier-2 (AgentDev) foundation — <agent>.eval-spec.json and <agent>.agent-spec.json — via the server-held agent-foundation prompt, ready for the Tier-2 rating gate. Requires a passed Tier-1 intake and a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_agent_foundation_prompt", "mcp__plugin_devgenie_devgenie-core__get_agent_foundation_prompt"]
---

You are running **/devgenie:agent-foundation** — the Tier-2 (AgentDev) foundation step. The methodology is delivered by the server — you fetch it and execute it; you never invent or substitute it.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop — a Lite key cannot run Tier-2.

1. **Precondition — Tier-1 intake must have passed.** Agent-foundation refuses to manufacture specs from inputs that haven't cleared the Tier-1 intake gate. Verify the **real marker**, never the `state.json` flag:
   ```
   jq -e '.gate=="intake" and .verdict=="PASS"' .devgenie/intake.json >/dev/null 2>&1 && echo "OK: intake passed" || echo "BLOCKED: no passed intake"
   ```
   If this prints `BLOCKED`, **stop** and tell the user to run **/devgenie:intake** first, then re-run `/devgenie:agent-foundation`. Do not proceed.

2. **Fetch the agent-foundation prompt.** Call the `get_agent_foundation_prompt` tool (the bundled `devgenie-core` MCP server) with `{ project_name, stack_hint?, scope? }`. The server returns the Tier-2 capture/foundation instructions, entitlement-clamped. If it returns an error envelope (`UPGRADE_REQUIRED`, `RATE_LIMITED`, `CORE_UNREACHABLE`, …), surface it plainly and stop.

3. **Execute exactly what the server returned** against `docs/inputs/` to draft `<agent>.eval-spec.json` and `<agent>.agent-spec.json` (where `<agent>` is the agent-id established by the brief). Challenge the brief; separate known / assumed / unknown for every claim.
   - **Crown-jewel rule (non-negotiable):** `<agent>.agent-spec.json`'s `prompt_contract` may carry **only** `version` and `must` — **never** prompt text. Any other key under `prompt_contract` smuggles server-held IP; refuse to write it.

4. **Do NOT rate your own work.** Rating is a separate, fresh-session step (`/devgenie:agent-gate`) — independence is structural. Do not score, approve, or proceed to the agent scaffold here.

5. **Advance state.** Set `.devgenie/state.json` `phase` to `agent_gate_pending`. Commit: `docs: agent foundation (eval+agent spec) for Tier-2 gate`.

6. **Hand off.** Tell the user to start a **fresh session** and run **/devgenie:agent-gate**. Do not proceed to `/devgenie:agent-scaffold` until that gate records an independent PASS.
