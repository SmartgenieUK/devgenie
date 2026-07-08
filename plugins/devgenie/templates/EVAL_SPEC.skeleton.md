# EVAL_SPEC.skeleton.md — Eval-Spec Authoring Guide
## <agent-id>.eval-spec.json · v0.1 · <date>

> **This document is the Tier-2 quality bar.** Where a Tier-1 contract is a *type* that others build against, a Tier-2 quality bar is a *score from an eval harness over a dataset* — correctness is not a type-check but a measured number. The `eval-spec` makes that number explicit: the dataset, the scoring function, and the thresholds that define "passing." It is what the `agent-gate` rates (the Tier-2 analogue of `ARCH.md`) and what the eval harness (S8-01) executes.
>
> Fill every section with *decisions and numbers*, not intentions. A field left as prose aspiration will fail the `jq` validation check at the bottom of this guide. When you cannot commit to a value, state it as an open assumption and route it to `docs/ASSUMPTIONS.md` — a confident number with no backing is a hidden assumption.
>
> **Conforms to:** `eval-spec/v1` (contract: `methodology/docs/contracts/eval-spec.md`, frozen 2026-06-28). A breaking schema change bumps to `/v2`; never reshape a field in place.

---

## `schema`

The version tag. Do not change this value — it is the join key the harness uses to select the right runner. Set exactly:

```
"schema": "eval-spec/v1"
```

<!-- e.g. "schema": "eval-spec/v1" -->

---

## `agent`

The agent-id this eval spec rates. Must match the `agent` field in the paired `<agent-id>.agent-spec.json` exactly — the harness joins on this string. Use the same stable identifier throughout the codebase (no spaces; kebab-case by convention).

<!-- e.g. "agent": "arch-rater" -->

---

## `dataset`

Where the eval cases live and the shape of one case. Three sub-fields, all required.

### `path`

A **repo-relative** path to the directory or file that holds the eval cases. Write it relative to the repo root (no leading `/`, no machine-absolute paths). Convention: `evals/<agent-id>/cases/`.

<!-- e.g. "path": "evals/arch-rater/cases/" -->

### `format`

The case file format. In `eval-spec/v1` this is locked to `"jsonl"` — one JSON object per line, one case per line, mirroring the ledger format used throughout the kit. Do not change this value in v1.

<!-- e.g. "format": "jsonl" -->

### `case_fields`

The fields that every case object in the dataset carries. This is an array of field-name strings. Two fields are required by the contract:

- `"input"` — what the agent receives (the prompt input the harness sends).
- `"expected"` — the reference answer the scoring function compares against.

Optional: `"tags"` — free-form labels that let you slice results by category (e.g. `["regression", "edge-case"]`). Add additional fields only if your scoring function or harness downstream requires them; prefer minimum required fields.

<!-- e.g. "case_fields": ["input", "expected", "tags"] -->

---

## `scoring`

The scoring function applied to each case. Three sub-fields, all required.

### `metric`

A **named, vendor-neutral** scoring function. The contract fixes the *slot* — a string name — not a vendor product. Use a well-understood name so any conforming harness implementation can substitute its own runner:

| Name | When to use |
|---|---|
| `exact_match` | Deterministic output where an exact string or structured match is the right bar. |
| `f1` | Token-overlap tasks (extraction, span detection) where partial credit is meaningful. |
| `rubric_judge` | Open-ended outputs where a rubric-following LLM judge is the right evaluator. |

Do not name a vendor, model, or API here — that is an implementation detail of the harness, not part of the spec. The same metric name must work if the harness swaps its judge model.

<!-- e.g. "metric": "rubric_judge" -->

### `range`

The score range a single case can take, as a two-element array `[min, max]`. In `eval-spec/v1` this is normalised to `[0, 1]`. The harness validates `min < max` and that your thresholds fall within this range.

<!-- e.g. "range": [0, 1] -->

### `aggregate`

How per-case scores are combined into the single number compared against `aggregate_min`. Choose one of the three allowed values:

| Value | Meaning |
|---|---|
| `"mean"` | Average score across all cases. Use when you want to reward partial credit across the distribution. |
| `"pass_rate"` | Fraction of cases meeting `per_case_min`. Use when you care about the proportion of clean passes, not the average magnitude. |
| `"min"` | The lowest individual score. Use when the whole run must clear the floor — equivalent to requiring every case to pass at `aggregate_min`. |

<!-- e.g. "aggregate": "mean" -->

---

## `thresholds`

What "passing" means, stated **numerically**. Both sub-fields are required. The passing rule is conjunctive: a run PASSes iff `aggregate(scores) >= aggregate_min` **and** `min(scores) >= per_case_min`. Both conditions must hold simultaneously.

### `aggregate_min`

The minimum aggregate score for a PASS. A number within `scoring.range`. Set this to a value your team has deliberate justification for — "0.9 because..." is the right form. Do not set it without reasoning.

<!-- e.g. "aggregate_min": 0.9 -->

### `per_case_min`

The floor every individual case must clear, regardless of the aggregate. A number within `scoring.range`.

**Why this field exists:** a high average score can hide a single catastrophic case — an agent that scores 1.0 on 19 cases and 0.0 on one still averages 0.95. The same logic drives the Tier-1 foundation gate: a high composite rating cannot rescue a weak load-bearing element. `per_case_min` is the Tier-2 expression of that same invariant. Set it to the lowest score you are willing to accept on any individual case before the whole run fails.

Typical pattern: `aggregate_min` high (e.g. 0.9), `per_case_min` lower but non-zero (e.g. 0.5), reflecting "good on average, never catastrophic."

<!-- e.g. "per_case_min": 0.5 -->

---

## `passing_means`

A single human-readable sentence stating what a PASS asserts about the agent. This is the intent behind the numbers — the claim your team is willing to stand behind when a run clears both thresholds. Write it as an assertion, not a description of the scoring rule:

- Bad: *"The agent scores >= 0.9 mean and no case below 0.5."* (that is just restating the numbers)
- Good: *"The agent reliably reproduces the reference verdict on well-formed ARCH.md inputs, with no case so wrong as to mislead a downstream decision."*

<!-- e.g. "passing_means": "The arch-rater reproduces the reference verdict on >=90% of cases on average, with no case scoring below 0.5." -->

---

## Self-check before committing

When you have produced your `<agent-id>.eval-spec.json`, validate it exits 0:

```bash
jq -e '
  .schema=="eval-spec/v1"
  and (.agent|type=="string")
  and (.dataset.format=="jsonl")
  and (.dataset.case_fields|index("input")) and (.dataset.case_fields|index("expected"))
  and (.scoring.metric|type=="string")
  and (.scoring.range|length==2) and (.scoring.range[0] < .scoring.range[1])
  and (.scoring.aggregate|IN("mean","pass_rate","min"))
  and (.thresholds.aggregate_min|type=="number")
  and (.thresholds.per_case_min|type=="number")
  and (.thresholds.aggregate_min >= .scoring.range[0] and .thresholds.aggregate_min <= .scoring.range[1])
  and (.thresholds.per_case_min >= .scoring.range[0] and .thresholds.per_case_min <= .scoring.range[1])
  and (.passing_means|type=="string" and length>0)
' <agent-id>.eval-spec.json >/dev/null \
&& echo "eval-spec contract OK"
```

Full contract and design notes: `methodology/docs/contracts/eval-spec.md`.

---
*SmartGenie Ltd · Proprietary IP. Produced under SmartForge V2.*
