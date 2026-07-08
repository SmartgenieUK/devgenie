#!/usr/bin/env bash
# check-regression.sh — the regression check: "must not regress vs. the last passing version" comparison.
#
# This is a COMPARISON added to the agent-slice loop's EXISTING per-turn run-evals.sh call
# (agent-slice/SKILL.md Step 3) — it is not a new loop, not a CI gate, and not a dataset-drift
# dashboard (all three are explicitly deferred until a later release earns them).
#
# Given the agent's append-only eval-run-log.jsonl and the CURRENT run's EVAL-RUN RESULT (the
# same JSON run-evals.sh prints / record-eval-run.sh consumes — see the eval-run-log contract),
# it finds the most recent PRIOR row with pass==true that carries eval-run-log/v2
# per-case scores, and flags any case whose score cleared per_case_min there but falls
# below per_case_min in the current run. It never invents a comparison against a run that failed —
# only a run that ACTUALLY passed is a "last passing version" to guard.
#
# Usage: check-regression.sh <eval-run-log.jsonl> <current-result.json> <per_case_min>
#
# Exit 0 — no prior passing version with per-case scores: nothing to regress against (this run is
#          the baseline). Also exit 0 when no case regressed.
# Exit 1 — at least one case that passed in the last passing version now fails; one JSON line per
#          regressed case is printed to stderr: {input, prev_score, prev_prompt_version, cur_score}.
set -euo pipefail

fail() { echo "check-regression: $1" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || fail "jq not found on PATH — required to compare eval-run-log rows."

LOG="${1:-}"; CUR="${2:-}"; PER_CASE_MIN="${3:-}"
if [ -z "$LOG" ] || [ -z "$CUR" ] || [ -z "$PER_CASE_MIN" ]; then
  echo "usage: check-regression.sh <eval-run-log.jsonl> <current-result.json> <per_case_min>" >&2
  exit 1
fi
jq -n --argjson p "$PER_CASE_MIN" -e '($p|type=="number")' >/dev/null 2>&1 \
  || fail "per_case_min must be a number: $PER_CASE_MIN"

[ -s "$CUR" ] || fail "current result file not found or empty: $CUR"
jq -e . "$CUR" >/dev/null 2>&1 || fail "current result is not valid JSON: $CUR"
jq -e '(.scores.per_case|type)=="array"' "$CUR" >/dev/null 2>&1 \
  || fail "current result carries no scores.per_case (per-case scores) — run-evals.sh always emits this; refusing to compare without it. Result file: $CUR"

# No log yet, or an unreadable/empty one -> nothing to regress against (this run is the baseline).
if [ ! -s "$LOG" ]; then
  echo "check-regression: no eval-run-log yet at $LOG — nothing to regress against (this run is the baseline)."
  exit 0
fi

# The most recent PRIOR row that both PASSED and carries per-case scores (v2). Rows that failed
# are never a regression baseline — only a version that actually passed is worth protecting.
PREV="$(jq -c 'select(.pass==true and (.scores.per_case|type)=="array")' "$LOG" 2>/dev/null | tail -1 || true)"
if [ -z "$PREV" ]; then
  echo "check-regression: no prior PASSING version with per-case scores in $LOG — nothing to regress against (this run is the baseline)."
  exit 0
fi

PREV_PC="$(mktemp)"
CUR_PC="$(mktemp)"
trap 'rm -f "$PREV_PC" "$CUR_PC"' EXIT
printf '%s' "$PREV" | jq -c '.scores.per_case' > "$PREV_PC"
jq -c '.scores.per_case' "$CUR" > "$CUR_PC"

REGRESSIONS="$(jq -n --slurpfile prev "$PREV_PC" --slurpfile cur "$CUR_PC" --argjson pcm "$PER_CASE_MIN" '
  ($prev[0]) as $prevcases | ($cur[0]) as $curcases |
  [ $prevcases[] | . as $p
    | ($curcases[] | select(.input == $p.input)) as $c
    | select(($p.score >= $pcm) and ($c.score < $pcm))
    | {input: $p.input, prev_score: $p.score, cur_score: $c.score}
  ]
')"

n="$(printf '%s' "$REGRESSIONS" | jq 'length')"
PREV_PV="$(printf '%s' "$PREV" | jq -r '.prompt_version')"
if [ "$n" -gt 0 ]; then
  echo "check-regression: REGRESSION vs the last passing version (prompt_version $PREV_PV) — $n case(s) that passed before now fail:" >&2
  printf '%s' "$REGRESSIONS" | jq -c '.[]' >&2
  exit 1
fi

echo "check-regression: OK — no case regressed vs the last passing version (prompt_version $PREV_PV)."
exit 0
