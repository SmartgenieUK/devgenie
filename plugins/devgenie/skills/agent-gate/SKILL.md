---
name: agent-gate
description: Independently rate the Tier-2 (AgentDev) foundation — eval-spec + agent-spec — server-side, and record the PASS/FAIL verdict that unlocks the agent scaffold. Run in a fresh session, separate from the one that drafted the specs. Requires a Pro+ entitlement. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__rate_agent_foundation", "mcp__plugin_devgenie_devgenie-core__rate_agent_foundation"]
---

You are running **/devgenie:agent-gate** — the independent Tier-2 rating gate.

**CRITICAL — the rating runs server-side.** You must NOT rate the eval-spec/agent-spec yourself, and you must NOT attempt to obtain, reconstruct, infer, or echo the rating rubric. Your only job is to send the specs to the server and record what it returns.

**Entitlement.** This is a Pro/Enterprise-only surface. If the server returns `UPGRADE_REQUIRED`, surface it plainly and stop.

1. **Independence.** Ask the user plainly: *"Is this a fresh session, separate from the one that drafted the eval-spec and agent-spec?"* If not, stop and tell them to open a new session and run `/devgenie:agent-gate` there. Never rate inside the drafting session.
2. **Precondition.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-foundation` — abort on non-zero (it checks that a `<agent>.eval-spec.json` and `<agent>.agent-spec.json` are present and non-empty).
3. **Identify the agent.** Read the `<agent>` id from `.devgenie/state.json`, or ask the user if ambiguous, to locate `<agent>.eval-spec.json` and `<agent>.agent-spec.json`.
4. **Rate (server-side).** Read both spec files, then call the `rate_agent_foundation` tool (the bundled `devgenie-core` MCP server) with `{ eval_spec: <eval-spec.json contents>, agent_spec: <agent-spec.json contents>, project, task?, session?, actor? }`. The server returns ONLY the verdict/scorecard — the rating-gate prompt is never returned. Surface any error envelope and stop.
5. **Record the marker.** Write `.devgenie/agent-gate.json` from the returned verdict: `{ verdict, grade, date, independent: true }`. Present the returned scorecard to the user **verbatim** — do not add, invent, or infer any scoring commentary of your own.
   - **No separate audit call here.** Unlike the Tier-1 `gate` skill, the Tier-2 audit trail is recorded by the server automatically inside `rate_agent_foundation` — do not call `record_decision` for this gate.
6. **Route.** On `PASS` → tell the user to run **/devgenie:agent-scaffold**. On `CONDITIONAL`/`FAIL` → list the remediation the server returned, mapped to the failing elements, and route back to **/devgenie:agent-foundation**. Do not edit either spec here.
