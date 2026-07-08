---
name: agent-scaffold
description: "Run the SmartForge Tier-2 agent scaffold (/devgenie:agent-scaffold). Stands up the eval harness, tool-definition stubs, and prompt skeleton v1.0 from a foundation that has PASSED the Tier-2 rating gate. Refuses if the Tier-2 gate has not passed with an independent verdict."
allowed-tools: [Bash, Read, Write]
---

# /devgenie:agent-scaffold — Tier-2 Phase-0 scaffold (Phase E, Tier 2)

**Explicit invocation only.** This command writes many files. Run it only when the user typed `/devgenie:agent-scaffold`. If you inferred the intent, do not act — offer the command and wait.

## Steps

1. **Gate check (mechanical, non-negotiable).** Run:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-scaffold
   ```
   This refuses unless `.devgenie/agent-gate.json` shows `verdict: PASS` and `independent: true`. (This arm of `guard.sh` is added as part of the same S8-03 wave; it is always present when this skill is reachable.) If it exits non-zero, stop and surface the message — do not work around it. The refusal is the product working.

2. **Scaffold the eval harness and agent stubs.** Identify the `<agent>` id from `.devgenie/state.json` (or ask if ambiguous). Then:

   a. **Copy the eval-harness template** from `${CLAUDE_PLUGIN_ROOT}/templates/eval-harness/` into the project at `evals/<agent>/` (creating the directory if needed):
   ```
   cp -r "${CLAUDE_PLUGIN_ROOT}/templates/eval-harness/." "evals/<agent>/"
   ```

   b. **Run the scaffold script** to emit the tool-definition stubs and the prompt skeleton:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/templates/agent-scaffold/scaffold-agent.sh" <agent>.agent-spec.json
   ```
   This emits:
   - Tool-definition stubs derived from the `tools[]` array in `<agent>.agent-spec.json`
   - The prompt skeleton `prompts/<agent>.v<version>.md` (the version is `prompt_contract.version` from the spec — typically `1.0.0` at scaffold) populated with the `must[]` invariants from `prompt_contract` — and **nothing else**

   **Crown-jewel rule (non-negotiable):** The scaffold script writes the `must[]` items as a checklist of required invariants and leaves the rest of the prompt blank. Write no business logic, no prompt text, no scenario narration — none of that lives in the kit. Any prompt content beyond the `must[]` items is server-held IP and must never appear in a scaffolded file. If the script emits anything beyond the `must[]` checklist structure, stop and surface it as a defect rather than committing it.

2b. **Append the Eval-Hardening slice (automatic).** After step 2 is complete, emit a Tier-2 task index at `docs/TASK_INDEX.md` (creating it if it does not yet exist). The task list must end with the Eval-Hardening anchor on its own line, exactly:
   `<!-- SMARTFORGE:EVAL-HARDENING-SLICE -->`
   Then run:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/append-hardening-slice.sh" docs/TASK_INDEX.md \
     --template "${CLAUDE_PLUGIN_ROOT}/templates/_TEMPLATE.eval-hardening.slice.md" \
     --anchor SMARTFORGE:EVAL-HARDENING-SLICE
   ```
   It inserts the Tier-2 Eval-Hardening slice at the anchor — **idempotent** (a re-run is a no-op), **non-destructive** (only adds), **fail-loud** (a malformed template or a missing anchor errors and writes nothing). If it exits non-zero, **stop and surface it** — do not hand-edit around it; the failure means the scaffold is malformed.

3. **Advance state and stop.** Update `.devgenie/state.json` `phase` → `agent_building`. Commit: `chore: Tier-2 Phase-0 scaffold (eval harness + tool defs + prompt v1.0)`.

   **Stop — do not start the agent-slice loop.** Present the scaffold inventory (harness path, tool stub count, prompt skeleton path, task index path) for human review. The `agent-slice` skill and its own gate check are the next step — they must be invoked explicitly.

## VERIFICATION

After completing all steps, confirm all four conditions hold by inspecting the artifacts directly — not by the scaffold script's self-report:

- **Eval harness exists:** `evals/<agent>/run-evals.sh` is present and executable.
- **Prompt skeleton exists and contains NO prompt text:** `prompts/<agent>.v<version>.md` (version from `prompt_contract.version`) exists, the `must[]` invariants from `prompt_contract` appear as the checklist structure, and no business-logic text / scenario narration appears beyond them. Grep for anything that looks like authored prose; if found, the crown-jewel rule was violated.
- **Agent spec is unmodified:** `<agent>.agent-spec.json` is byte-identical to the file the Tier-2 gate rated — `git diff <agent>.agent-spec.json` is clean.
- **Eval-Hardening slice appended:** `docs/TASK_INDEX.md` contains the BEGIN marker — confirm with:
  ```
  grep -F '<!-- SMARTFORGE:EVAL-HARDENING-SLICE:BEGIN' docs/TASK_INDEX.md
  ```
  If the line is absent, the slice was not appended; stop and surface the appender's error output.
