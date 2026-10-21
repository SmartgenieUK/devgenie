# EVAL_SPEC.skeleton.md — Eval-Spec Schema
## <agent-id>.eval-spec.json · v0.1 · <date>

> **Conforms to:** `eval-spec/v1` (contract: `methodology/docs/contracts/eval-spec.md`).

---

## Schema Fields

| Field | Type | Description |
|---|---|---|
| `schema` | `string` | Must be `"eval-spec/v1"` |
| `agent` | `string` | Target agent identifier matching paired agent-spec |
| `dataset.path` | `string` | Repo-relative path to eval cases (e.g. `evals/<agent-id>/cases/`) |
| `dataset.format` | `string` | Case file format (`"jsonl"`) |
| `dataset.case_fields` | `string[]` | Array of case fields, must include `"input"` and `"expected"` |
| `scoring.metric` | `string` | Named metric function (e.g. `"exact_match"`, `"f1"`, `"rubric_judge"`) |
| `scoring.range` | `[number, number]` | Normalized score range `[min, max]`, e.g. `[0, 1]` |
| `scoring.aggregate` | `string` | Aggregation method (`"mean"`, `"pass_rate"`, or `"min"`) |
| `thresholds.aggregate_min` | `number` | Minimum required aggregate score |
| `thresholds.per_case_min` | `number` | Floor for individual case scores |
| `passing_means` | `string` | Human-readable statement of what a pass asserts |

---

## Example Schema Object

```json
{
  "schema": "eval-spec/v1",
  "agent": "sample-agent",
  "dataset": {
    "path": "evals/sample-agent/cases/",
    "format": "jsonl",
    "case_fields": ["input", "expected", "tags"]
  },
  "scoring": {
    "metric": "exact_match",
    "range": [0, 1],
    "aggregate": "mean"
  },
  "thresholds": {
    "aggregate_min": 1.0,
    "per_case_min": 1.0
  },
  "passing_means": "The sample-agent produces exact matching outputs for all valid inputs."
}
```

---

## Validation

Validate `<agent-id>.eval-spec.json` with `jq`:

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
