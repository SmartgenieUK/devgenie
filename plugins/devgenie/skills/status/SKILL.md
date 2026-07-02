---
name: status
description: Read-only report — phase, task progress, gate history, and AI-spend per slice. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, "mcp__devgenie-core__get_chargeback_report", "mcp__plugin_devgenie_devgenie-core__get_chargeback_report"]
---

You are running **/devgenie:status** — read-only. Never modify any file.

1. **Phase + task.** Read `.devgenie/state.json` (phase, active task) and `docs/TASK_INDEX.md` (done vs pending). Summarise where the project is.
2. **Gate history.** If `.devgenie/gate.json` exists, show the latest verdict / grade and whether it was independent; call out any `CONDITIONAL`/`FAIL` prominently.
3. **AI spend (local).** If `metrics/token-ledger.jsonl` exists and is non-empty, roll up `total_billed` per slice/task and show the cost-per-slice benchmark. If it's empty, note that metering starts once `/devgenie:scaffold` has installed the hooks (and to check the SessionEnd hook is wired).
4. **Chargeback (Pro+).** If the user is entitled, offer to call `get_chargeback_report` (the bundled `devgenie-core` MCP server) for a server-side roll-up by slice / task / model / month. For Lite, surface `UPGRADE_REQUIRED` plainly — don't fake a report.
