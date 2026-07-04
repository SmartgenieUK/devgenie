---
name: intake
description: Rate the raw inputs in docs/inputs/ against the DevGenie intake specification (Tier-1 front door) — PASS/CONDITIONAL/FAIL. Foundation is locked until intake passes. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_entitlements", "mcp__plugin_devgenie_devgenie-core__get_entitlements", "mcp__devgenie-core__get_intake_prompt", "mcp__plugin_devgenie_devgenie-core__get_intake_prompt"]
---

You are running **/devgenie:intake** — the Tier-1 front door that rates whether `docs/inputs/` is rich enough to architect from. This skill holds **no methodology**: the intake rubric is authored server-side and delivered fresh on every run. Your job is to fetch it and execute it faithfully.

**Explicit invocation only.** Run this only because the user typed `/devgenie:intake`. If you inferred the intent from conversation, offer the command and wait.

1. **Greet + tier.** Call `get_entitlements` (the bundled `devgenie-core` MCP server) and tell the user, in one line, their tier (Lite / Pro / Enterprise) and build scope. If the server is unreachable, stop and say so — DevGenie is online-only.

2. **Fetch the server-held intake prompt.** Call **`get_intake_prompt`** — do **not** pass `scope` (intake is full-scope at every tier). If it returns a structured error envelope (`AUTH_INVALID`, `RATE_LIMITED`, `CORE_UNREACHABLE`, …), surface it plainly and stop — never hand-roll a verdict.

3. **Execute the returned prompt verbatim.** Become that prompt and follow its steps exactly, in order — its inline presence check, the five-input rubric, the frozen verdict mapping, the two artifact writes (`.devgenie/intake.json` + `docs/inputs/intake-report.json`), the gate-ledger row, the `intake_pending → foundation_pending`-on-PASS advance, and its routing (PASS → `/devgenie:foundation`; CONDITIONAL/FAIL → supply the thin/missing inputs / elicitation, **never manufacture** an input to pass). The returned prompt is the single source of truth.

Intake rates the **inputs**, not a document — it never writes `ARCH.md`. Foundation is **locked** until intake records PASS.
