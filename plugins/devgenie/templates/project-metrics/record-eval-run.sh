#!/usr/bin/env bash
# record-eval-run.sh — append one eval-run-log row per eval run (score tied to prompt version).
# Durable, append-only eval-run history (NOT the operational token-ledger): one line per eval
# run — the Tier-2 analogue of record-gate.sh. Row shape is FROZEN by the
# eval-run-log contract §2:
#   {schema, run_id, ts, agent, prompt_version, eval_spec:{id,version}, scores:{aggregate,n_cases}, pass}
# eval-run-log/v2 adds an ADDITIVE scores.per_case[] array — stamped automatically when
# the result carries it (see the schema-select below); v1 aggregate readers are unaffected.
#
# VERIFY-THE-ARTIFACT: agent / prompt_version / eval_spec / scores / pass are READ FROM the
# result file the row derives from (produced by run-evals.sh), never taken on the
# caller's word — so a ledger row can never disagree with the result it claims to record.
# A missing or wrong-typed prompt_version is a hard fail (no silent row + exit 0).
# Invoked by the agent-slice loop after each eval run.
set -euo pipefail

result_file=""
run_id_arg=""

while [ $# -gt 0 ]; do
  case "$1" in
    --result) result_file="${2-}"; shift 2 ;;
    --run-id) run_id_arg="${2-}"; shift 2 ;;
    *) echo "record-eval-run: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

command -v jq >/dev/null 2>&1 || {
  echo "record-eval-run: jq not found on PATH — required to read the result file and build the row." >&2; exit 1; }

# --result is REQUIRED and must exist, be non-empty, and parse as JSON.
# No result -> no provable row -> refuse; never append a guessed row and exit 0.
[ -n "$result_file" ] || { echo "record-eval-run: --result is required (the eval-run result JSON file)" >&2; exit 1; }
[ -s "$result_file" ] || { echo "record-eval-run: result file '$result_file' missing or empty — cannot derive a row from a result that isn't there" >&2; exit 1; }
jq -e . "$result_file" >/dev/null 2>&1 || { echo "record-eval-run: result file '$result_file' is not valid JSON" >&2; exit 1; }

# agent: REQUIRED non-empty string (read from the result file).
agent="$(jq -r '.agent // empty' "$result_file")"
[ -n "$agent" ] || { echo "record-eval-run: result file '$result_file' has no non-empty .agent" >&2; exit 1; }

# prompt_version: REQUIRED non-empty string — THE load-bearing tie the whole log exists for.
# Fail loud if missing or empty; a row without a prompt version is a silent lie.
prompt_version="$(jq -r '.prompt_version // empty' "$result_file")"
[ -n "$prompt_version" ] || { echo "record-eval-run: result file '$result_file' has no non-empty .prompt_version — this is the load-bearing tie; refusing to write an unattributable row" >&2; exit 1; }

# eval_spec.id: REQUIRED non-empty string.
eval_spec_id="$(jq -r '.eval_spec.id // empty' "$result_file")"
[ -n "$eval_spec_id" ] || { echo "record-eval-run: result file '$result_file' has no non-empty .eval_spec.id" >&2; exit 1; }

# eval_spec.version: REQUIRED non-empty string.
eval_spec_version="$(jq -r '.eval_spec.version // empty' "$result_file")"
[ -n "$eval_spec_version" ] || { echo "record-eval-run: result file '$result_file' has no non-empty .eval_spec.version" >&2; exit 1; }

# scores.aggregate: REQUIRED number.
scores_aggregate_type="$(jq -r '.scores.aggregate | type' "$result_file" 2>/dev/null || echo "")"
[ "$scores_aggregate_type" = "number" ] || { echo "record-eval-run: result file '$result_file' .scores.aggregate is missing or not a number (got type '${scores_aggregate_type:-<missing>}')" >&2; exit 1; }

# scores.n_cases: REQUIRED number.
scores_n_cases_type="$(jq -r '.scores.n_cases | type' "$result_file" 2>/dev/null || echo "")"
[ "$scores_n_cases_type" = "number" ] || { echo "record-eval-run: result file '$result_file' .scores.n_cases is missing or not a number (got type '${scores_n_cases_type:-<missing>}')" >&2; exit 1; }

# pass: REQUIRED real boolean.
pass_type="$(jq -r '.pass | type' "$result_file" 2>/dev/null || echo "")"
[ "$pass_type" = "boolean" ] || { echo "record-eval-run: result file '$result_file' .pass is missing or not a boolean (got type '${pass_type:-<missing>}')" >&2; exit 1; }

# run_id: from --run-id if given, else deterministic-ish from epoch + short agent hash.
if [ -n "$run_id_arg" ]; then
  run_id="$run_id_arg"
else
  agent_hash="$(printf '%s' "$agent" | cksum | awk '{printf "%04x", $1 % 65536}')"
  run_id="run_$(date +%s)_${agent_hash}"
fi

ts="$(date -u +%FT%TZ)"

# Ledger file: <agent>.eval-run-log.jsonl (filename derived from the agent id, by contract §2).
ledger="${agent}.eval-run-log.jsonl"

# Schema select: eval-run-log/v2 when the result carries an additive per-case score array,
# else v1. The per_case field is ADDITIVE — a v1 aggregate reader ignores it — so
# writing v2 never breaks a v1 consumer, and an aggregate-only result still writes a v1 row.
# For a v2 row the FULL scores object is carried through VERBATIM, so the additive
# scores.trajectory / scores.safety ride along untouched (never reshaping per_case or aggregate).
if jq -e '(.scores.per_case|type)=="array"' "$result_file" >/dev/null 2>&1; then
  schema="eval-run-log/v2"
  scores_json="$(jq -c '.scores' "$result_file")"
else
  schema="eval-run-log/v1"
  scores_json="$(jq -c '.scores | {aggregate, n_cases}' "$result_file")"
fi

# Additive top-level run evidence: pillars (Four-Pillars verdicts) + reliability (pass^k).
# Carried through only when the result carries them (a run that used no eval-spec/v2 dimension
# writes exactly the v1 row). "{}" merges to nothing — additive, never a reshape.
pillars_json="$(jq -c 'if has("pillars") then {pillars} else {} end' "$result_file")"
reliability_json="$(jq -c 'if has("reliability") then {reliability} else {} end' "$result_file")"

# One append-only row, exactly the FROZEN §2 shape (no invented fields).
# --argjson for scores (numbers) and pass (boolean) to preserve their JSON types.
# tr -d '\r' guards a native-Windows jq's CRLF output.
pass_json="$(jq -r '.pass' "$result_file")"

jq -nc \
  --arg schema "$schema" \
  --arg run_id "$run_id" \
  --arg ts "$ts" \
  --arg agent "$agent" \
  --arg prompt_version "$prompt_version" \
  --arg eval_spec_id "$eval_spec_id" \
  --arg eval_spec_version "$eval_spec_version" \
  --argjson scores "$scores_json" \
  --argjson pass "$pass_json" \
  --argjson pillars "$pillars_json" \
  --argjson reliability "$reliability_json" \
  '{schema:$schema, run_id:$run_id, ts:$ts, agent:$agent, prompt_version:$prompt_version,
    eval_spec:{id:$eval_spec_id, version:$eval_spec_version},
    scores:$scores, pass:$pass} + $pillars + $reliability' \
  | tr -d '\r' >> "$ledger"
