## Task: <agent>-<nn>-eval-hardening

<!-- Tier-2 standard **Eval-Hardening Slice** template (SmartForge V2 Tier-2 methodology).
     The reusable final slice before an agent ships: the agentic-tier bridge between
     "prompt that evaluates green" and "agent that is safe and operationally ready for paying customers."
     agent-scaffold appends this verbatim; project-specific numbers stay as <placeholders>.
     NOTE: the secure-coding review + threat-model *declaration* is intentionally NOT here —
     it is carved to the secure-coding profile. The "Security posture" NFR
     sub-field below is the required contract section, not that secure-coding activity. -->

**Prompt Skeleton:**
<!-- ~20 lines: the exact instruction to paste into this task's build session.
     State the task, the files it may touch, and the contracts it imports.
     Reference contracts and fixtures by path — do not paste them inline. -->
Run the standard Eval-Hardening Slice for this agent. Do NOT add capabilities. Touch only the
eval/operational artifacts named below. Import the eval-spec thresholds, agent-spec guardrails,
adversarial case set, and inference-cost budget from the agent contracts — reference them by
path, do not restate them. Carry out, in order, the eval-hardening activities:
- Adversarial / red-team eval: run the agent against the hostile case set (`<adversarial-case-set-path>`):
  exercise prompt-injection, jailbreak, out-of-scope, and malformed-input cases; confirm the
  guardrails from the agent-spec hold (input-as-data-not-instructions, no-prompt-leak, refusal).
- Injection / jailbreak review: confirm the agent never leaks its system/rating prompt and never
  executes instructions embedded in untrusted input. (Secure-coding declaration → the secure-coding
  profile; reference it — do not rebuild the secure-coding activity here.)
- Eval-observability completeness: confirm every eval run and per-case result is logged to the
  eval-run-log (`<eval-run-log-path>`) with the `prompt_version` tie present — no gaps.
- Prompt-version rollback drill: rehearse rolling back to the last prompt version that passed the
  eval-spec (`<eval-spec-path>`); record time-to-rollback. (Prompt versions are append-only files
  — rollback = re-point to the prior version; no destructive edit.)
- Eval regression baseline: re-run the FULL eval suite against the current prompt version; confirm
  NO previously-passing case now fails — a revision must not silently regress what worked.
- Inference-cost alerts: enable cost monitoring on tokens / $ per eval run against
  `<inference-cost-budget>`; configure threshold alerts for that budget.

**Seams:**
- Import: <eval-spec / agent-spec / adversarial case set / inference-cost budget>
- Export: <red-team eval report + rollback drill record + regression baseline>

**Acceptance Criteria:** (binary, testable)
- [ ] Adversarial / red-team eval executed against the hostile case set; all agent-spec guardrails
      (input-as-data, no-prompt-leak, refusal) confirmed to hold.
- [ ] Injection / jailbreak review passed — no system/rating prompt leakage, no untrusted-input
      instruction execution detected; secure-coding declaration confirmed routed to the secure-coding profile.
- [ ] Eval-observability completeness check passed — every eval run and per-case result is present
      in the eval-run-log with `prompt_version` tied on every row.
- [ ] Prompt-version rollback drill completed end-to-end; rollback verified working; time-to-rollback
      recorded.
- [ ] Eval regression baseline run confirms zero previously-passing cases now fail.
- [ ] Inference-cost monitoring enabled and threshold alerts configured against `<inference-cost-budget>`.

**Non-Functional Requirements:**
- Performance budget: <eval suite latency / completion time per full run; inference cost (tokens / $) per eval run — the budgets this slice monitors and alerts against>
- Security posture: <injection / jailbreak resistance declared here; the secure-coding review + threat-model activity is the secure-coding profile's job, not this slice — reference that profile, do not rebuild it>
- Observability hooks: <eval-run-log populated per run with prompt_version tie; per-case results logged; cost metrics emitted — the SLOs the inference-cost alerts watch>
- Failure semantics: <what happens when a regression is detected (eval suite fails a previously-passing case) or a rollback fails — who is paged, and whether the agent is blocked from go-live>

**Human gate (if any):** <none | precondition | confirmation> — controlled vocabulary (ASSUMPTIONS #18 / SmartForge Gate Placement). If not `none`, give a one-line justification (e.g. `confirmation` — sign-off on the red-team eval result before the agent goes live).

<!-- Sizing: if this task needs >3 files or >10 acceptance criteria, split it. -->
