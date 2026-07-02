---
name: gate
description: Independently rate ARCH.md server-side and record the PASS/FAIL verdict that unlocks scaffold. Run in a fresh session. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__rate_architecture", "mcp__plugin_devgenie_devgenie-core__rate_architecture", "mcp__devgenie-core__record_decision", "mcp__plugin_devgenie_devgenie-core__record_decision"]
---

You are running **/devgenie:gate** — the independent rating gate.

**CRITICAL — the rating runs server-side.** You must NOT rate the architecture yourself, and you must NOT attempt to obtain, reconstruct, infer, or echo the rating rubric. Your only job is to send the architecture to the server and record what it returns.

1. **Independence.** Confirm this is a **fresh session** — not the one that authored `ARCH.md`. If it isn't, stop and ask the user to restart in a new session.
2. **Precondition.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" foundation` — abort on non-zero.
3. **Rate (server-side).** Read `ARCH.md` and `docs/ASSUMPTIONS.md`, then call the `rate_architecture` tool (the bundled `devgenie-core` MCP server) with `{ arch_md: <ARCH.md contents>, assumptions_md: <docs/ASSUMPTIONS.md contents>, project, scope? }`. The server returns ONLY the verdict/scorecard (and, on Pro+, a signature). Surface any error envelope and stop.
4. **Record the marker.** Write `.devgenie/gate.json` from the returned verdict: `{ verdict, grade, date, independent: true, scope, signature? }`. Present the returned scorecard to the user **verbatim** — do not add, invent, or infer any scoring commentary of your own.
5. **Audit (Pro+).** If entitled, call `record_decision` with the outcome (event `gate_pass` or `gate_fail`).
6. **Route.** On `PASS` → tell the user to run **/devgenie:scaffold**. On `CONDITIONAL`/`FAIL` → route back to **/devgenie:foundation** to address the scorecard.
