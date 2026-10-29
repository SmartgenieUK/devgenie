---
name: foundation
description: Capture the spec and produce ARCH.md via the server-held foundation prompt, then hand off to the rating gate. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_foundation_prompt", "mcp__plugin_devgenie_devgenie-core__get_foundation_prompt"]
---

You are running **/devgenie:foundation**. The methodology is delivered by the server — you fetch it and execute it; you never invent or substitute it.

1. **Precondition — intake must have passed with a signed result (foundation is LOCKED until it does).** Foundation refuses to build on inputs that haven't cleared the Tier-1 intake gate. Run the guard's check, never your own reading of the marker or the `state.json` flag:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" intake-receipt
   ```
   It verifies DevGenie's signature on `.devgenie/intake.json` and accepts only PASS or CONDITIONAL. If it exits non-zero, **stop**, show its message (it names the **/devgenie:intake** re-run), then re-run `/devgenie:foundation` once intake has a signed result. Do not proceed.
2. **Fetch the foundation prompt.** Call the `get_foundation_prompt` tool (the bundled `devgenie-core` MCP server) with `{ project_name, stack_hint?, scope? }`. The server returns the capture/foundation instructions, scope-clamped to your entitlement. If it returns an error envelope (`RATE_LIMITED`, `UPGRADE_REQUIRED`, `CORE_UNREACHABLE`, …), surface it plainly and stop.
3. **Execute exactly what the server returned** to produce `ARCH.md` and `docs/ASSUMPTIONS.md` from the brief in `docs/inputs/`. DevGenie's step-ledger script is `${CLAUDE_PLUGIN_ROOT}/scripts/step-ledger.sh`. When the prompt says to run the step-ledger script your DevGenie skill named, run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/step-ledger.sh" <step> <outcome>` with the step and outcome the prompt gives.
4. **Advance state.** Set `.devgenie/state.json` `phase` to `gate_pending`. Commit: `docs: foundation draft for rating gate`.
5. **Hand off.** Relay the served prompt's hand-off to **/devgenie:gate**.
