---
name: agent-slice
description: "Run the SmartForge Tier-2 build loop (/devgenie:agent-slice) for one agent — prompt → eval → diagnose → revise. Runs the eval-spec against the current prompt version, appends the result to the eval-run-log (score tied to that prompt version), and on a fail diagnoses the weakness and revises the prompt as a NEW version (never in place). One improvement attempt per session for clean attribution. Run each loop turn in a fresh session."
allowed-tools: [Bash, Read, Write, Edit, EnterPlanMode, ExitPlanMode]
---

# /devgenie:agent-slice — one prompt→eval→diagnose→revise turn (Phase F, Tier 2)

**Explicit invocation only.** Run the steps below only when the user typed `/devgenie:agent-slice`. If you arrived here by inferring intent from conversation, do not act — offer the command and wait for them to invoke it.

**One improvement attempt, one fresh session.** This is the Tier-2 analogue of `/devgenie:slice`: where `slice` builds one Tier-1 task per session, `agent-slice` runs **one turn of the build loop** — one eval run, and at most one prompt revision — per session. Clean attribution depends on it: each prompt version's score is logged as its own eval-run-log row, so "did this revision actually help?" is answerable only when each turn is isolated. This version is procedural; you run one turn and open a fresh session for the next. (A later version will drive the loop's sessions automatically — the same subprocess upgrade as the gate and `slice`.)

The loop's load-bearing property: **every score is tied to the exact `prompt_version` that produced it**, via the eval-run-log. The improvement is provable *because* of that tie, not in spite of it. The prompt text itself is **crown-jewel IP** — it lives only in the versioned prompt file, never in the agent-spec and never in the eval-run-log.

## Steps

1. **Gate check.** The loop refuses to run without the Tier-2 Phase-0 scaffold (harness + tool defs + prompt v1.0). Run:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-slice
   ```
   Abort if it fails — there is no agent scaffold to drive the loop against. Route the user to `/devgenie:agent-scaffold` (the Tier-2 Phase-0 scaffold) and stop. Do not work around the guard.

2. **Establish the prompt version under test.** Identify the `<agent>` id (from `.devgenie/state.json`, or ask if ambiguous). Read the current prompt file `prompts/<agent>.v<version>.md` — its version is the `prompt_contract.version` line in `<agent>.agent-spec.json`. This `<version>` is the thing under test; carry it through Steps 3–5 verbatim. Do **not** read the prompt body into anything you will write to the agent-spec or the eval-run-log (crown-jewel).

3. **Run the eval, then log the result.** Run the eval-spec against the current prompt version through the frozen RUNNER → WRITER interface:
   - **Run:**
     ```
     bash evals/<agent>/run-evals.sh <agent>.eval-spec.json <version> [--agent-hook <script>]
     ```
     It prints an **EVAL-RUN RESULT** JSON and exits 0; it fails loud (non-zero) on a bad spec or missing dataset — treat any non-zero exit as a hard stop, not a zero score. Capture the printed result to a file (e.g. `result.json`).
   - **Regression-check (CR-091), before logging.** Compare this run's per-case scores against the last PASSING version already in the log — a case that passed before must not now silently fail:
     ```
     bash "${CLAUDE_PLUGIN_ROOT}/templates/eval-harness/check-regression.sh" \
       <agent>.eval-run-log.jsonl result.json <per_case_min>
     ```
     (`<per_case_min>` comes from `<agent>.eval-spec.json`'s `thresholds.per_case_min`.) This is **one comparison added to this existing step** — not a new loop, not a CI gate (CI-gated enforcement is explicitly deferred, `methodology/docs/quality-flywheel.md`). No prior passing row ⇒ exit 0 (this run is the baseline; nothing to compare). A non-zero exit means a previously-passing case just regressed — treat it **exactly like a failed eval run**: go to Step 4 (diagnose) even if this run's own `pass` reads `true`. Do not log a row and call the loop done over a flagged regression.
   - **Append the durable row** via the WRITER — one FROZEN `eval-run-log/v1` row to `<agent>.eval-run-log.jsonl`:
     ```
     bash "${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/record-eval-run.sh" --result result.json
     ```
     This is append-only and ties the score to `prompt_version` (the whole reason the log exists). Never hand-edit the JSONL.
   - **Show the user:** the `scores.aggregate`, `scores.n_cases`, `pass`, the `prompt_version` it was tied to, and — if it failed — **which cases failed** (from the runner output). Report the artifact, not a summary: confirm the new row with `tail -1 <agent>.eval-run-log.jsonl`.

   **If `pass` is `true` AND the regression-check exited 0:** the prompt clears the eval-spec thresholds (`aggregate >= aggregate_min` **and** `min(case) >= per_case_min`) and dropped nothing the last passing version had. The loop is **done** — record progress (Step 6) and stop. Do not revise a passing prompt. A `pass:true` result alongside a flagged regression is **not** done — treat it as a failure (Step 4).

4. **Diagnose, don't guess — then STOP for approval.** Only if the run **failed** the thresholds: analyse the *specific* failing cases the runner reported, identify the concrete prompt weakness each one exposes, and propose a targeted revision. Then present a plan and **write nothing until the user approves** — this is the Tier-2 manifest gate, the mirror of `slice` Step 4:
   - **Diagnosis:** each failing case → the invariant or behaviour the current prompt version got wrong → the change that addresses it. Tie the diagnosis to evidence from the run, not intuition.
   - **The plan:** the new prompt version number (Step 5), exactly what will change and *why*, and the single agent-spec field that moves (`prompt_contract.version`). State explicitly that the prior prompt version file will **not** be touched.
   - **Hard gate:** present the plan via plan mode (`ExitPlanMode`) — or, if not in plan mode, ask for explicit confirmation — and do not edit the prompt or the agent-spec until the user approves. If the revision turns out to need a change outside this plan, surface it and get approval first.

5. **Revise as a NEW version — never in place.** On approval:
   - **Write a new prompt file** `prompts/<agent>.v<next-version>.md` (bump `<version>` → `<next-version>`). **Never overwrite or edit the prior prompt version file** — the whole point of the loop is attributable comparison across versions, and the eval-run-log ties each score to the version that produced it; mutating a prior version destroys that tie. (You author the loop's discipline here; the *prompt text* is crown-jewel IP — write it per the agent's brief, never copy it into the agent-spec or the log.)
   - **Bump the contract:** update `prompt_contract.version` in `<agent>.agent-spec.json` to `<next-version>`. Change only that field; carry `must[]` forward unless the revision genuinely changes an invariant. The agent-spec still carries **contract only, never prompt text** — re-confirm the key-whitelist (`prompt_contract` may hold only `version` and `must`).
   - **Re-run the eval on the new version: go back to Step 3** with `<next-version>`. Its result is a **new logged row** — that second row, scored against the same eval-spec, is what makes the improvement provable. (Per "one attempt per session," the re-run that proves the new version typically opens the next fresh session; do it now only if the same-session re-run keeps attribution clean for your harness.)

6. **Commit one loop turn; mark progress.** Commit a single turn of the loop — one logical change (the eval run + its logged row, or the run + the new prompt version + the contract bump). The `prepare-commit-msg` hook adds the token trailer; the `SessionEnd` hook records the ledger row. Note the turn's outcome (which prompt version, pass/fail) in the task ledger. **Stop when the eval passes** (Step 3) **or when the user calls the loop.** Do not loop indefinitely; each turn is its own session.

## VERIFICATION

After completing the turn, prove the artifacts — not your report:
- **The eval-run-log has a row for the prompt version tested.** `tail -1 <agent>.eval-run-log.jsonl` shows the `prompt_version` you tested, its `scores.aggregate`, and `pass`. The version on the row must match the version Step 2/Step 5 put under test.
- **The score is tied to the prompt version, not floating.** The latest row's `prompt_version` equals the `prompt_contract.version` of the prompt that produced it (the tie the whole log exists for).
- **A revision created a NEW versioned file, never mutated the old one.** If Step 5 ran, `prompts/<agent>.v<next-version>.md` exists as a new file **and** the prior `prompts/<agent>.v<version>.md` is unchanged (verify both are present; the old one was not overwritten). The agent-spec's `prompt_contract.version` now reads `<next-version>` and `prompt_contract` still contains only `version` and `must` (crown-jewel key-whitelist holds).
- **No prompt text leaked.** Neither `<agent>.agent-spec.json` nor `<agent>.eval-run-log.jsonl` contains prompt body — only the contract/version and the score/version respectively.
