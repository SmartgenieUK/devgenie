---
name: foundation
description: Capture the spec and produce ARCH.md via the server-held foundation prompt, then hand off to the rating gate. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_foundation_prompt", "mcp__plugin_devgenie_devgenie-core__get_foundation_prompt"]
---

You are running **/devgenie:foundation**. The methodology is delivered by the server — you fetch it and execute it; you never invent or substitute it.

1. **Precondition — intake must have passed (foundation is LOCKED until it does).** Foundation refuses to build on inputs that haven't cleared the Tier-1 intake gate. Verify the **real marker**, never the `state.json` flag:
   ```
   jq -e '.gate=="intake" and .verdict=="PASS"' .devgenie/intake.json >/dev/null 2>&1 && echo "OK: intake passed" || echo "BLOCKED: no passed intake"
   ```
   If this prints `BLOCKED` (marker missing, or verdict not `PASS`), **stop** and tell the user to run **/devgenie:intake** first (rate the brief in `docs/inputs/`), then re-run `/devgenie:foundation`. Do not proceed.
2. **Fetch the foundation prompt.** Call the `get_foundation_prompt` tool (the bundled `devgenie-core` MCP server) with `{ project_name, stack_hint?, scope? }`. The server returns the capture/foundation instructions, scope-clamped to your entitlement. If it returns an error envelope (`RATE_LIMITED`, `UPGRADE_REQUIRED`, `CORE_UNREACHABLE`, …), surface it plainly and stop.
3. **Execute exactly what the server returned** to produce `ARCH.md` and `docs/ASSUMPTIONS.md` from the brief in `docs/inputs/`. Every non-obvious ("assumed") claim in `ARCH.md` must also appear in `docs/ASSUMPTIONS.md`.
4. **Do NOT rate your own work.** Rating is a separate, fresh-session step (`/devgenie:gate`) — independence is structural.
5. **Advance state.** Set `.devgenie/state.json` `phase` to `gate_pending`. Commit: `docs: foundation draft for rating gate`.
6. **Hand off.** Tell the user to start a **fresh session** and run **/devgenie:gate**.
