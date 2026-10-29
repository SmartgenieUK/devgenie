---
name: intake
description: Rate the raw inputs in docs/inputs/ for the DevGenie Tier-1 front door — you rate and cite, the DevGenie server tool s_intake decides PASS / CONDITIONAL / HOLD / FAIL and signs it. Foundation is locked until a signed PASS or CONDITIONAL. Explicit invocation only.
disable-model-invocation: true
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_entitlements", "mcp__plugin_devgenie_devgenie-core__get_entitlements", "mcp__devgenie-core__get_intake_prompt", "mcp__plugin_devgenie_devgenie-core__get_intake_prompt", "mcp__devgenie-core__s_intake", "mcp__plugin_devgenie_devgenie-core__s_intake"]
---

You are running **/devgenie:intake** — the Tier-1 front door that finds out whether `docs/inputs/` carries what each engineering layer needs. This skill holds **no methodology**: the intake prompt is authored server-side and delivered fresh on every run. **You perceive; the server judges**: you rate, cite, ask and record, and the server tool `s_intake` decides the verdict and signs it.

**Explicit invocation only.** Run this only because the user typed `/devgenie:intake`. If you inferred the intent from conversation, offer the command and wait.

1. **Greet + tier.** Call `get_entitlements` (the bundled `devgenie-core` MCP server) and tell the user, in one line, their plan and build scope. If the server is unreachable, stop and say so — DevGenie is online-only.

2. **Presence gate.** Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" intake`. If it exits non-zero, stop and show its message — the fix is to add the brief or discovery notes.

3. **Fetch the server-held intake prompt.** Call **`get_intake_prompt`** with `{ project_name }` (the current project or repo name). Do **not** pass `scope`. If it returns a structured error envelope (`AUTH_INVALID`, `RATE_LIMITED`, `CORE_UNREACHABLE`, …), surface it plainly and stop — never hand-roll a verdict. The response carries `files[]` beside the prompt: the two intake scripts (the marker writer and the VERIFICATION check), each `{ path, content }`. Keep them. Write each entry exactly as returned, with the Write tool, replacing any older copy at that path (only this release's writer can record a signed result). Never retype a body the server sent.

4. **Execute the returned prompt verbatim.** Become that prompt and follow its steps in order. In short: confirm the starting type (new projects only in this release); ask the build depth; rate every element `PRESENT | PARTIAL | ABSENT` with `{file, line}` citations, set the six facts and fill the solution card, asking every question the inputs leave open with its elaboration (what it means, why it matters, what a good answer contains, an example); re-open every citation; call **`s_intake`** and save its result verbatim; on HOLD ask the one gap question, save the answer under `docs/inputs/`, and call again; then run the served writer (`.devgenie/scripts/write-intake-marker.sh`), which records the signed decision as `.devgenie/intake.json`. If you cannot call `s_intake`, this plugin is older than 0.3.7: tell the user to update it as the prompt says.

Intake never writes `ARCH.md`; you never edit the intake marker or decide a verdict yourself. Foundation unlocks only on a PASS or CONDITIONAL whose signed receipt verifies.
