#!/usr/bin/env bash
# run-evals.sh — the Tier-2 eval harness runner (SmartForge V2 · S8-01).
#
# Consumes a FROZEN eval-spec (v1 or v2 — methodology/docs/contracts/eval-spec.md), runs an
# agent over a jsonl dataset, scores each case, aggregates, applies the passing rule, and prints
# ONE EVAL-RUN RESULT JSON object to stdout.
#
# EVAL-RUN RESULT = the frozen eval-run-log row MINUS schema/run_id/ts (those are stamped by
# the writer, S8-05). Base shape (eval-run-log/v2 — per-case scores, CR-088):
#   { "agent":"<id>", "prompt_version":"<x.y.z>",
#     "eval_spec":{"id":"<id>","version":"<vN>"},
#     "scores":{"aggregate":<number>,"n_cases":<int>,
#               "per_case":[{"input":"<case input>","score":<number>}, ...]},
#     "pass":<bool> }
#
# eval-spec/v2 (CR-089) adds — ALL ADDITIVE, emitted only when the relevant v2 feature is
# declared, so a v1 spec produces the exact v1/CR-088 result unchanged:
#   scores.trajectory : {aggregate, min, n}     — the trajectory dimension (Efficiency evidence)
#   scores.safety     : {n_cases, n_failed, pass}— the guardrail/red-team Safety pillar evidence
#   pillars           : {effectiveness, efficiency, robustness, safety}  — Four-Pillars verdicts
#   reliability       : {k, passes, pass_k}      — pass^k repeat-run reliability
# A v1 aggregate reader (scores.aggregate/n_cases + prompt_version) reads a v2 result unchanged.
#
# CR-091 (golden-set discipline) adds ONE further ADDITIVE block, a dataset-organization
# convention rather than a new required schema field — see methodology/templates/eval-harness/
# README.md §8 and methodology/docs/quality-flywheel.md:
#   scores.tiers : { "<tier>": {n_cases, pass_rate} }  — per-tier pass rates when >=1 case (any
#   case, effectiveness OR safety) carries an optional ".tier" field ("typical"|"edge"|
#   "adversarial" by convention). The adversarial tier is the CR-089 guardrail/safety case class's
#   home, so a tier's n_cases/pass_rate can blend effectiveness passes and safety-probe passes —
#   both are "did this case behave" evidence. Emitted only when at least one case carries .tier;
#   a dataset with no tiers produces exactly the pre-CR-091 result (no scores.tiers key at all).
#
# THE FOUR-PILLARS BAR (CR-089) — Safety is a NON-TRADEABLE GATE:
#   overall pass = Effectiveness AND Efficiency AND Safety   (Robustness = the per_case_min floor)
#   A Safety failure fails the whole bar REGARDLESS of the other pillars — it is a gate, never a
#   score averaged into the others. "The trajectory is the truth"; a safety leak fails it outright.
#
# METRICS (scoring.metric — a vendor-neutral slot, eval-spec §2b):
#   exact_match  — string equality (1.0 / 0.0).
#   f1           — token-level F1 over .expected vs the agent output (fractional [0,1]).
#   rubric_judge — a REAL judge, wired via --judge-hook / $DEVGENIE_JUDGE_HOOK. With no judge
#                  configured it FAILS LOUD — it NEVER silently degrades to exact-match (CR-088).
#
# Discovery-Mode: this is the THINNEST real end-to-end harness, not a production rig.
# It really runs, really scores, and really fails loud. Verify the artifact, not the report.
#
# Usage:
#   bash run-evals.sh <eval-spec.json> <prompt-version> \
#        [--agent-hook <script>] [--judge-hook <script>] [--trajectory-hook <script>]
#
# Pass rule (per run, conjunctive across pillars — Safety non-tradeable):
#   effectiveness = (aggregate >= aggregate_min) AND (min(non-safety case) >= per_case_min)
#   efficiency    = trajectory absent OR trajectory_min unset OR (trajectory aggregate >= trajectory_min)
#   safety        = every safety case passes its guardrail probe (no leak, refusal present)
#   run pass      = effectiveness AND efficiency AND safety
# pass^k (thresholds.pass_k = K): the run is repeated K times; overall pass = all K runs passed.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: run-evals.sh <eval-spec.json> <prompt-version> [--agent-hook <s>] [--judge-hook <s>] [--trajectory-hook <s>] [--trace-out <path>]

  <eval-spec.json>     path to an eval-spec/v1 or /v2 file (methodology/docs/contracts/eval-spec.md)
  <prompt-version>     the prompt version under test, e.g. 1.0.0 (tied to the result so a
                       score is attributable to the exact prompt that produced it)
  --agent-hook <s>     OPTIONAL. A script that, given a case .input on argv[1] AND on stdin,
                       prints the agent's output to stdout. Without it, the runner falls back to a
                       .predicted field on each case (deterministic demo/test mode — no LLM).
  --judge-hook <s>     OPTIONAL (REQUIRED when scoring.metric is rubric_judge). A vendor-neutral
                       judge script: judge-hook <input> <expected> <output> -> ONE [0,1] score.
                       Also settable via $DEVGENIE_JUDGE_HOOK. With rubric_judge and NO judge
                       configured the runner FAILS LOUD — it never silently scores exact-match.
  --trajectory-hook <s> OPTIONAL (eval-spec/v2). A script that, given a case .input on argv[1] AND
                       on stdin, prints the agent's ACTUAL tool-call sequence as a JSON array of
                       tool names to stdout. Without it, a case's .predicted_trajectory field is
                       used (deterministic demo/test mode). Only consulted when scoring.trajectory
                       is declared and a case carries .expected_trajectory.
  --trace-out <path>   OPTIONAL (CR-090, observability seed). Writes a small OTel-shaped run-trace
                       artifact to <path>: an agent.session span wrapping per-case agent.think spans
                       (scores.per_case, CR-088) and agent.tool spans (trajectory data, CR-089) —
                       populated entirely from data this run already computes, never invented.
                       Absent by default; omitting it changes nothing about stdout. See
                       methodology/docs/run-trace-scaffold.md (a scaffold, not a frozen contract).

Prints ONE EVAL-RUN RESULT JSON object to stdout and exits 0.
Fails loud (exit 1, message to stderr) on a missing/invalid eval-spec or dataset, or on a
case whose output cannot be obtained — never emits an empty result and exits 0.
EOF
}

fail() { echo "run-evals: $1" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || fail "jq not found on PATH — required to read the eval-spec and score cases. Install jq and retry."

# ---- args -------------------------------------------------------------------
SPEC="${1:-}"
PROMPT_VERSION="${2:-}"
AGENT_HOOK=""
JUDGE_HOOK="${DEVGENIE_JUDGE_HOOK:-}"   # env default; --judge-hook flag (below) overrides it.
TRAJ_HOOK=""
TRACE_OUT=""   # CR-090: optional run-trace artifact path; empty = no trace written (back-compat).
if [ -z "$SPEC" ] || [ -z "$PROMPT_VERSION" ]; then usage; exit 1; fi
shift 2 || true
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-hook)
      AGENT_HOOK="${2:-}"
      [ -n "$AGENT_HOOK" ] || fail "--agent-hook requires a script path."
      [ -f "$AGENT_HOOK" ] || fail "--agent-hook script not found: $AGENT_HOOK"
      shift 2 ;;
    --judge-hook)
      JUDGE_HOOK="${2:-}"
      [ -n "$JUDGE_HOOK" ] || fail "--judge-hook requires a script path."
      shift 2 ;;
    --trajectory-hook)
      TRAJ_HOOK="${2:-}"
      [ -n "$TRAJ_HOOK" ] || fail "--trajectory-hook requires a script path."
      [ -f "$TRAJ_HOOK" ] || fail "--trajectory-hook script not found: $TRAJ_HOOK"
      shift 2 ;;
    --trace-out)
      TRACE_OUT="${2:-}"
      [ -n "$TRACE_OUT" ] || fail "--trace-out requires a file path."
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1 (see --help)" ;;
  esac
done
# If a judge hook is configured, it must exist — fail loud now, not mid-run.
[ -z "$JUDGE_HOOK" ] || [ -f "$JUDGE_HOOK" ] || fail "judge hook script not found: $JUDGE_HOOK"

# ---- read + validate the eval-spec (accepts v1 AND v2) ----------------------
[ -s "$SPEC" ] || fail "eval-spec not found or empty: $SPEC"
jq -e . "$SPEC" >/dev/null 2>&1 || fail "eval-spec is not valid JSON: $SPEC"

# Same contract assertions as methodology/docs/contracts/eval-spec.md §3, widened to v1|v2.
jq -e '
  (.schema|test("^eval-spec/v[12]$"))
  and (.agent|type=="string")
  and (.dataset.path|type=="string")
  and (.dataset.format=="jsonl")
  and (.scoring.metric|type=="string")
  and (.scoring.range|length==2) and (.scoring.range[0] < .scoring.range[1])
  and (.scoring.aggregate|IN("mean","pass_rate","min"))
  and (.thresholds.aggregate_min|type=="number")
  and (.thresholds.per_case_min|type=="number")
  # v2 additive fields (optional; well-formed when present):
  and (if (.scoring|has("trajectory")) then (.scoring.trajectory.match|IN("in_order","any_order","exact")) else true end)
  and (if (.thresholds|has("pass_k")) then (.thresholds.pass_k|type=="number" and .>=1) else true end)
  and (if (.thresholds|has("trajectory_min")) then (.thresholds.trajectory_min|type=="number") else true end)
' "$SPEC" >/dev/null 2>&1 || fail "eval-spec does not satisfy eval-spec/v1|v2 (schema/agent/dataset/scoring/thresholds[/trajectory/pass_k]) — see methodology/docs/contracts/eval-spec.md"

AGENT="$(jq -r '.agent' "$SPEC")"
SPEC_VERSION="$(jq -r '.schema | sub("^eval-spec/";"")' "$SPEC")"   # "eval-spec/v2" -> "v2"
DATASET_PATH="$(jq -r '.dataset.path' "$SPEC")"
METRIC="$(jq -r '.scoring.metric' "$SPEC")"
RANGE_MIN="$(jq -r '.scoring.range[0]' "$SPEC")"
RANGE_MAX="$(jq -r '.scoring.range[1]' "$SPEC")"
AGGREGATE="$(jq -r '.scoring.aggregate' "$SPEC")"
AGG_MIN="$(jq -r '.thresholds.aggregate_min' "$SPEC")"
PER_CASE_MIN="$(jq -r '.thresholds.per_case_min' "$SPEC")"
# v2 features (empty string = not declared).
TRAJ_MATCH="$(jq -r '.scoring.trajectory.match // empty' "$SPEC")"
TRAJ_MIN="$(jq -r '.thresholds.trajectory_min // empty' "$SPEC")"
PASS_K="$(jq -r '.thresholds.pass_k // empty' "$SPEC")"

# ---- resolve the dataset to a single jsonl stream ---------------------------
resolve_path() {
  local p="$1"
  if [ -e "$p" ]; then echo "$p"; return 0; fi
  local base; base="$(dirname "$SPEC")"
  if [ -e "$base/$p" ]; then echo "$base/$p"; return 0; fi
  echo ""; return 0
}
DS="$(resolve_path "$DATASET_PATH")"
[ -n "$DS" ] || fail "dataset path does not exist (as given or relative to the eval-spec): $DATASET_PATH"

CASES_TMP="$(mktemp)"
trap 'rm -f "$CASES_TMP"' EXIT
if [ -d "$DS" ]; then
  found=0
  for f in "$DS"/*.jsonl; do
    [ -f "$f" ] || continue
    cat "$f" >> "$CASES_TMP"
    found=1
  done
  [ "$found" -eq 1 ] || fail "dataset dir holds no *.jsonl case files: $DS"
else
  cat "$DS" >> "$CASES_TMP"
fi
grep -q '[^[:space:]]' "$CASES_TMP" || fail "dataset is empty (no cases): $DS"

# ---- scoring helpers --------------------------------------------------------
# Token-level F1 (multiset) between .expected and the agent output.
f1_score() {
  local expected="$1" output="$2"
  jq -n --arg e "$expected" --arg o "$output" '
    def toks: ascii_downcase | [scan("[a-z0-9]+")];
    ($e|toks) as $et | ($o|toks) as $ot |
    ($et|length) as $en |
    if $en==0 then error("empty-expected")
    else
      ($ot|length) as $pn |
      ($ot | reduce .[] as $t ({}; .[$t] = ((.[$t]//0) + 1))) as $oc |
      (reduce $et[] as $t ({c:0,m:$oc};
         if ((.m[$t])//0) > 0 then {c:(.c+1), m:(.m|.[$t]=(.[$t]-1))} else . end) | .c) as $common |
      if $pn==0 then 0
      else ($common/$pn) as $p | ($common/$en) as $r |
        if ($p+$r)==0 then 0 else (2*$p*$r)/($p+$r) end
      end
    end' 2>/dev/null
}

score_case() {
  # args: <input> <expected> <output>
  local input="$1" expected="$2" output="$3" s
  case "$METRIC" in
    exact_match)
      if [ "$output" = "$expected" ]; then echo "1.0"; else echo "0.0"; fi
      ;;
    f1)
      s="$(f1_score "$expected" "$output")" \
        || fail "metric 'f1': .expected has no scoreable tokens (needs alphanumeric text) — this case shape does not support f1. Use rubric_judge for non-text expectations. Case input: $input"
      echo "$s"
      ;;
    rubric_judge)
      [ -n "$JUDGE_HOOK" ] || fail "scoring.metric is 'rubric_judge' but no judge is configured. Pass --judge-hook <script> or set \$DEVGENIE_JUDGE_HOOK. Refusing to silently degrade to exact-match. For deterministic scoring use metric 'exact_match' or 'f1'."
      s="$(printf '%s' "$output" | bash "$JUDGE_HOOK" "$input" "$expected" "$output")" \
        || fail "metric 'rubric_judge': judge hook exited non-zero: $JUDGE_HOOK (input: $input)"
      echo "$s"
      ;;
    *)
      fail "unsupported scoring.metric '$METRIC' — this harness implements exact_match, f1, and rubric_judge (a real LLM judge via --judge-hook). Add your metric to score_case()."
      ;;
  esac
}

# Trajectory dimension score (eval-spec/v2): expected vs actual tool-call sequence, per match mode.
#   exact     -> 1.0 iff sequences identical, else 0.0
#   in_order  -> (greedy ordered-subsequence matches) / |expected|   ("the trajectory is the truth")
#   any_order -> (multiset intersection size)         / |expected|
traj_score() {
  # args: <match> <expected-json-array> <actual-json-array>
  jq -n --arg m "$1" --argjson e "$2" --argjson a "$3" '
    ($e|length) as $en |
    if $en==0 then error("empty-expected-trajectory")
    elif $m=="exact" then (if $e==$a then 1.0 else 0.0 end)
    elif $m=="any_order" then
      (reduce $e[] as $t ({c:0, m:($a|reduce .[] as $x ({}; .[$x]=((.[$x]//0)+1)))};
         if ((.m[$t])//0) > 0 then {c:(.c+1), m:(.m|.[$t]=(.[$t]-1))} else . end) | .c) as $common
      | ($common/$en)
    elif $m=="in_order" then
      (reduce $a[] as $x ({i:0}; if (.i < $en) and ($x==($e[.i])) then {i:(.i+1)} else . end) | .i) as $matched
      | ($matched/$en)
    else error("bad-match-mode") end'
}

# Guardrail / red-team Safety probe (eval-spec/v2): deterministic evidence for the Safety pillar.
#   forbidden    (string|array) — a leak sentinel; if ANY appears in the output -> FAIL (prompt leak)
#   must_contain (string|array) — a required refusal marker; if ANY is absent    -> FAIL (no refusal)
# Prints "1" (safe) or "0" (breach). Substring match, case-insensitive — no regex pitfalls.
safety_case_pass() {
  # args: <case-json> <output>
  jq -n --argjson c "$1" --arg o "$2" '
    (($c.forbidden // []) | if type=="string" then [.] else . end) as $forb |
    (($c.must_contain // []) | if type=="string" then [.] else . end) as $must |
    (any($forb[]; . as $f | (($o|ascii_downcase)|contains($f|ascii_downcase)))) as $leaked |
    (all($must[]; . as $m | (($o|ascii_downcase)|contains($m|ascii_downcase)))) as $refused |
    if $leaked then 0 elif ($refused|not) then 0 else 1 end'
}

obtain_output() {
  # args: <case-json>  -> prints the agent output, or fails loud.
  local case_json="$1" input
  input="$(printf '%s' "$case_json" | jq -r '.input')"
  if [ -n "$AGENT_HOOK" ]; then
    printf '%s' "$input" | bash "$AGENT_HOOK" "$input"
  else
    if printf '%s' "$case_json" | jq -e 'has("predicted")' >/dev/null; then
      printf '%s' "$case_json" | jq -r '.predicted'
    else
      fail "no output for a case: no --agent-hook given and case has no .predicted field. Refusing to score a missing output. Case input: $input"
    fi
  fi
}

obtain_trajectory() {
  # args: <case-json>  -> prints the agent's ACTUAL tool-call sequence as a JSON array, or fails loud.
  local case_json="$1" input
  input="$(printf '%s' "$case_json" | jq -r '.input')"
  if [ -n "$TRAJ_HOOK" ]; then
    printf '%s' "$input" | bash "$TRAJ_HOOK" "$input"
  else
    if printf '%s' "$case_json" | jq -e 'has("predicted_trajectory")' >/dev/null; then
      printf '%s' "$case_json" | jq -c '.predicted_trajectory'
    else
      fail "trajectory scoring is declared (scoring.trajectory) and this case has .expected_trajectory, but no --trajectory-hook was given and the case has no .predicted_trajectory. Refusing to score a missing trajectory. Case input: $input"
    fi
  fi
}

# ---- one scoring pass over the whole dataset --------------------------------
# Emits ONE summary JSON to stdout; writes per-case {input,score} lines to $1 (the per_case file,
# consumed by the eval-run-log/v2 scores.per_case, CR-088) and per-case trajectory evidence
# {input,expected_trajectory,actual_trajectory,score} lines to $2 (the run-trace seed's agent.tool
# spans, CR-090 — a local scratch artifact, not part of any locked schema) and per-case tier
# evidence {tier,pass} lines to $3 (CR-091's scores.tiers — a local scratch artifact too, only
# written for cases that carry an optional .tier field). Re-reads the dataset each call so pass^k
# repeats are independent runs (a stateful --agent-hook can vary its output across repeats — that
# is exactly what pass^k measures).
run_once() {
  local percase_out="$1" traj_percase_out="$2" tier_percase_out="$3"
  : > "$percase_out"
  : > "$traj_percase_out"
  : > "$tier_percase_out"
  local n_cases=0 sum="0" min_score="" pass_count=0
  local traj_n=0 traj_sum="0" traj_min=""
  local safety_n=0 safety_failed=0

  while IFS= read -r line; do
    printf '%s' "$line" | grep -q '[^[:space:]]' || continue
    printf '%s' "$line" | jq -e . >/dev/null 2>&1 || fail "dataset line is not valid JSON: $line"
    printf '%s' "$line" | jq -e 'has("input")' >/dev/null 2>&1 \
      || fail "dataset case missing .input: $line"

    # --- Safety / guardrail case (eval-spec/v2): NON-TRADEABLE gate, not an effectiveness case ---
    if printf '%s' "$line" | jq -e '.safety==true' >/dev/null 2>&1; then
      local sout sp
      sout="$(obtain_output "$line")"
      sp="$(safety_case_pass "$line" "$sout")"
      safety_n=$((safety_n + 1))
      if [ "$sp" != "1" ]; then safety_failed=$((safety_failed + 1)); fi
      # Tier evidence (CR-091): a safety case's tier bucket is usually "adversarial" (that tier's
      # home per eval-spec.md §2d-ii), but any tier value the case carries is honored as-is.
      if printf '%s' "$line" | jq -e 'has("tier")' >/dev/null 2>&1; then
        printf '%s' "$line" | jq -c --argjson pass "$([ "$sp" = "1" ] && echo true || echo false)" \
          '{tier: .tier, pass: $pass}' >> "$tier_percase_out"
      fi
      continue
    fi

    # --- Effectiveness case (must carry .expected) ---
    printf '%s' "$line" | jq -e 'has("expected")' >/dev/null 2>&1 \
      || fail "dataset case missing .expected (non-safety case): $line"

    if [ "$METRIC" = "f1" ]; then
      printf '%s' "$line" | jq -e '.expected|type=="string"' >/dev/null 2>&1 \
        || fail "metric 'f1' needs a string .expected (token-level F1); this case's .expected is not a string. Use rubric_judge for structured expectations. Case: $line"
    fi

    local input expected output s
    input="$(printf '%s' "$line" | jq -r '.input')"
    expected="$(printf '%s' "$line" | jq -r '.expected')"
    output="$(obtain_output "$line")"

    s="$(score_case "$input" "$expected" "$output")"
    printf '%s' "$s" | jq -e --argjson lo "$RANGE_MIN" --argjson hi "$RANGE_MAX" \
      '(type=="number") and (. >= $lo) and (. <= $hi)' >/dev/null 2>&1 \
      || fail "scoring produced an out-of-range / non-numeric score '$s' (range [$RANGE_MIN,$RANGE_MAX])"

    printf '%s' "$line" | jq -c --argjson score "$s" '{input: .input, score: $score}' >> "$percase_out"

    # Tier evidence (CR-091): an effectiveness case's tier-bucket pass = clears per_case_min,
    # same floor the Robustness pillar already uses — no new passing rule invented.
    if printf '%s' "$line" | jq -e 'has("tier")' >/dev/null 2>&1; then
      local tier_pass
      tier_pass="$(jq -n --argjson s "$s" --argjson f "$PER_CASE_MIN" '$s >= $f')"
      printf '%s' "$line" | jq -c --argjson pass "$tier_pass" '{tier: .tier, pass: $pass}' >> "$tier_percase_out"
    fi

    n_cases=$((n_cases + 1))
    sum="$(jq -n --argjson a "$sum" --argjson b "$s" '$a + $b')"
    if [ -z "$min_score" ]; then min_score="$s"; else
      min_score="$(jq -n --argjson a "$min_score" --argjson b "$s" 'if $b < $a then $b else $a end')"
    fi
    if jq -n --argjson s "$s" --argjson f "$PER_CASE_MIN" -e '$s >= $f' >/dev/null; then
      pass_count=$((pass_count + 1))
    fi

    # --- Trajectory dimension (eval-spec/v2), only for cases declaring .expected_trajectory ---
    if [ -n "$TRAJ_MATCH" ] && printf '%s' "$line" | jq -e 'has("expected_trajectory")' >/dev/null 2>&1; then
      local et at ts
      et="$(printf '%s' "$line" | jq -c '.expected_trajectory')"
      printf '%s' "$et" | jq -e 'type=="array"' >/dev/null 2>&1 \
        || fail "case .expected_trajectory must be a JSON array of tool names: $line"
      at="$(obtain_trajectory "$line")"
      printf '%s' "$at" | jq -e 'type=="array"' >/dev/null 2>&1 \
        || fail "the actual trajectory must be a JSON array of tool names (got: $at) for case input: $input"
      ts="$(traj_score "$TRAJ_MATCH" "$et" "$at")"
      printf '%s' "$ts" | jq -e '(type=="number") and (.>=0) and (.<=1)' >/dev/null 2>&1 \
        || fail "trajectory scoring produced an out-of-range / non-numeric score '$ts'"
      traj_n=$((traj_n + 1))
      traj_sum="$(jq -n --argjson a "$traj_sum" --argjson b "$ts" '$a + $b')"
      if [ -z "$traj_min" ]; then traj_min="$ts"; else
        traj_min="$(jq -n --argjson a "$traj_min" --argjson b "$ts" 'if $b < $a then $b else $a end')"
      fi
      # Per-case trajectory evidence for the run-trace seed's agent.tool spans (CR-090) — real
      # expected/actual sequences and the real per-case score, never a placeholder.
      jq -nc --arg input "$input" --argjson exp "$et" --argjson act "$at" --argjson score "$ts" \
        '{input:$input, expected_trajectory:$exp, actual_trajectory:$act, score:$score}' >> "$traj_percase_out"
    fi
  done < "$CASES_TMP"

  [ "$n_cases" -gt 0 ] || fail "no effectiveness cases scored — a Safety eval gates an effectiveness eval; supply at least one non-safety case. Dataset: $DS"

  # --- aggregate the effectiveness pillar ---
  local aggregate
  case "$AGGREGATE" in
    mean)      aggregate="$(jq -n --argjson s "$sum" --argjson n "$n_cases" '$s / $n')" ;;
    pass_rate) aggregate="$(jq -n --argjson p "$pass_count" --argjson n "$n_cases" '$p / $n')" ;;
    min)       aggregate="$min_score" ;;
    *)         fail "unsupported aggregate '$AGGREGATE' (mean|pass_rate|min)" ;;
  esac

  # --- pillar verdicts ---
  local eff_pass eff2_pass rob_pass safety_pass traj_agg
  eff_pass="$(jq -n --argjson agg "$aggregate" --argjson aggmin "$AGG_MIN" \
    --argjson minc "$min_score" --argjson pcm "$PER_CASE_MIN" '($agg >= $aggmin) and ($minc >= $pcm)')"
  rob_pass="$(jq -n --argjson minc "$min_score" --argjson pcm "$PER_CASE_MIN" '$minc >= $pcm')"

  if [ "$traj_n" -gt 0 ]; then
    traj_agg="$(jq -n --argjson s "$traj_sum" --argjson n "$traj_n" '$s / $n')"
    if [ -n "$TRAJ_MIN" ]; then
      eff2_pass="$(jq -n --argjson a "$traj_agg" --argjson m "$TRAJ_MIN" '$a >= $m')"
    else
      eff2_pass="true"   # trajectory scored but no floor set -> informational, not gating
    fi
  else
    traj_agg=""
    eff2_pass="true"     # no trajectory dimension -> Efficiency pillar not applicable, passes
  fi

  # Safety is the NON-TRADEABLE gate: any failing safety case fails the pillar (and the whole bar).
  if [ "$safety_n" -gt 0 ]; then
    if [ "$safety_failed" -eq 0 ]; then safety_pass="true"; else safety_pass="false"; fi
  else
    safety_pass="true"   # no safety cases -> Safety pillar not exercised, does not block (the
                         # requirement for a safety case class on untrusted-input agents is
                         # enforced by the server-side Tier-2 rating gate, not this runner)
  fi

  local run_pass
  run_pass="$(jq -n --argjson e "$eff_pass" --argjson f "$eff2_pass" --argjson g "$safety_pass" \
    '$e and $f and $g')"

  # One summary object (numbers stay numbers via --argjson).
  jq -n \
    --argjson aggregate "$aggregate" \
    --argjson n_cases "$n_cases" \
    --arg traj_agg "$traj_agg" \
    --arg traj_min "${traj_min:-}" \
    --argjson traj_n "$traj_n" \
    --argjson safety_n "$safety_n" \
    --argjson safety_failed "$safety_failed" \
    --argjson eff_pass "$eff_pass" \
    --argjson eff2_pass "$eff2_pass" \
    --argjson rob_pass "$rob_pass" \
    --argjson safety_pass "$safety_pass" \
    --argjson run_pass "$run_pass" \
    '{
       aggregate:$aggregate, n_cases:$n_cases,
       traj_agg:(if $traj_agg=="" then null else ($traj_agg|tonumber) end),
       traj_min:(if $traj_min=="" then null else ($traj_min|tonumber) end),
       traj_n:$traj_n,
       safety_n:$safety_n, safety_failed:$safety_failed,
       eff_pass:$eff_pass, eff2_pass:$eff2_pass, rob_pass:$rob_pass, safety_pass:$safety_pass,
       run_pass:$run_pass
     }'
}

# ---- pass^k outer loop ------------------------------------------------------
K=1
if [ -n "$PASS_K" ]; then K="$PASS_K"; fi

PC1_TMP="$(mktemp)"            # representative (run 1) per_case
PC_SCRATCH="$(mktemp)"
TRAJ_PC1_TMP="$(mktemp)"       # representative (run 1) per-case trajectory evidence (CR-090 seed)
TRAJ_PC_SCRATCH="$(mktemp)"
TIER_PC1_TMP="$(mktemp)"       # representative (run 1) per-case tier evidence (CR-091)
TIER_PC_SCRATCH="$(mktemp)"
trap 'rm -f "$CASES_TMP" "$PC1_TMP" "$PC_SCRATCH" "$TRAJ_PC1_TMP" "$TRAJ_PC_SCRATCH" "$TIER_PC1_TMP" "$TIER_PC_SCRATCH"' EXIT

passes=0
first_summary=""
r=1
while [ "$r" -le "$K" ]; do
  summary="$(run_once "$PC_SCRATCH" "$TRAJ_PC_SCRATCH" "$TIER_PC_SCRATCH")"
  rp="$(printf '%s' "$summary" | jq -r '.run_pass')"
  if [ "$rp" = "true" ]; then passes=$((passes + 1)); fi
  if [ "$r" -eq 1 ]; then first_summary="$summary"; cp "$PC_SCRATCH" "$PC1_TMP"; cp "$TRAJ_PC_SCRATCH" "$TRAJ_PC1_TMP"; cp "$TIER_PC_SCRATCH" "$TIER_PC1_TMP"; fi
  r=$((r + 1))
done

# Reliability: pass^k holds iff EVERY one of the K repeats passed. Overall pass = pass^k.
if [ "$passes" -eq "$K" ]; then pass_k_ok="true"; else pass_k_ok="false"; fi
overall_pass="$pass_k_ok"

# ---- emit the EVAL-RUN RESULT (base v1/CR-088 shape + additive v2 blocks) ----
PER_CASE="$(jq -s '.' "$PC1_TMP")"

# Base result — identical to the v1/CR-088 shape (a v1 aggregate reader is unaffected).
RESULT="$(jq -n \
  --arg agent "$AGENT" \
  --arg pv "$PROMPT_VERSION" \
  --arg specid "$AGENT" \
  --arg specver "$SPEC_VERSION" \
  --argjson agg "$(printf '%s' "$first_summary" | jq '.aggregate')" \
  --argjson n "$(printf '%s' "$first_summary" | jq '.n_cases')" \
  --argjson percase "$PER_CASE" \
  --argjson pass "$overall_pass" \
  '{
     agent: $agent,
     prompt_version: $pv,
     eval_spec: { id: $specid, version: $specver },
     scores: { aggregate: $agg, n_cases: $n, per_case: $percase },
     pass: $pass
   }')"

# Additive v2 block: scores.trajectory (Efficiency evidence), only when trajectory was scored.
if [ "$(printf '%s' "$first_summary" | jq -r '.traj_n')" != "0" ]; then
  RESULT="$(printf '%s' "$RESULT" | jq \
    --argjson tagg "$(printf '%s' "$first_summary" | jq '.traj_agg')" \
    --argjson tmin "$(printf '%s' "$first_summary" | jq '.traj_min')" \
    --argjson tn   "$(printf '%s' "$first_summary" | jq '.traj_n')" \
    '.scores.trajectory = {aggregate:$tagg, min:$tmin, n:$tn}')"
fi

# Additive v2 block: scores.safety (the guardrail/red-team Safety pillar evidence).
if [ "$(printf '%s' "$first_summary" | jq -r '.safety_n')" != "0" ]; then
  RESULT="$(printf '%s' "$RESULT" | jq \
    --argjson sn "$(printf '%s' "$first_summary" | jq '.safety_n')" \
    --argjson sf "$(printf '%s' "$first_summary" | jq '.safety_failed')" \
    --argjson sp "$(printf '%s' "$first_summary" | jq '.safety_pass')" \
    '.scores.safety = {n_cases:$sn, n_failed:$sf, pass:$sp}')"
fi

# Additive block: scores.tiers — per-tier pass rates (CR-091), only when >=1 case (effectiveness
# or safety) carried a .tier field. A dataset with no tiers emits no scores.tiers key at all.
if [ -s "$TIER_PC1_TMP" ]; then
  TIERS_JSON="$(jq -sc '
    group_by(.tier) | map({
      key: .[0].tier,
      value: { n_cases: length, pass_rate: ((map(select(.pass==true)) | length) / length) }
    }) | from_entries
  ' "$TIER_PC1_TMP")"
  RESULT="$(printf '%s' "$RESULT" | jq --argjson t "$TIERS_JSON" '.scores.tiers = $t')"
fi

# Additive v2 block: pillars — the Four-Pillars verdicts (Safety is the non-tradeable gate).
# Emitted whenever any v2 dimension is in play (trajectory or safety declared).
if [ -n "$TRAJ_MATCH" ] || [ "$(printf '%s' "$first_summary" | jq -r '.safety_n')" != "0" ]; then
  RESULT="$(printf '%s' "$RESULT" | jq \
    --argjson e "$(printf '%s' "$first_summary" | jq '.eff_pass')" \
    --argjson f "$(printf '%s' "$first_summary" | jq '.eff2_pass')" \
    --argjson r "$(printf '%s' "$first_summary" | jq '.rob_pass')" \
    --argjson s "$(printf '%s' "$first_summary" | jq '.safety_pass')" \
    '.pillars = {effectiveness:$e, efficiency:$f, robustness:$r, safety:$s}')"
fi

# Additive v2 block: reliability (pass^k), only when pass_k was declared.
if [ -n "$PASS_K" ]; then
  RESULT="$(printf '%s' "$RESULT" | jq \
    --argjson k "$K" --argjson p "$passes" --argjson pk "$pass_k_ok" \
    '.reliability = {k:$k, passes:$p, pass_k:$pk}')"
fi

# ---- OTel-shaped run-trace seed (CR-090, observability seed) — OPT-IN, --trace-out only --------
# A small structured artifact, NOT the eval-run-log row: an agent.session span wrapping per-case
# agent.think spans (scores.per_case, CR-088) and agent.tool spans (trajectory evidence, CR-089),
# populated verbatim from data this run already computed above — nothing invented. Absent by
# default; when --trace-out is not given this block never runs and stdout is unchanged (see the
# back-compat test in test/run-trace-seed.sh). Scaffold shape only — see
# methodology/docs/run-trace-scaffold.md; not a frozen contract, deliberately not locked yet.
if [ -n "$TRACE_OUT" ]; then
  THINK_SPANS="$(jq -sc '[ .[] | {name:"agent.think", attributes:{input:.input, score:.score}} ]' "$PC1_TMP")"
  TOOL_SPANS="$(jq -sc '[ .[] | {name:"agent.tool", attributes:{input:.input, expected_trajectory:.expected_trajectory, actual_trajectory:.actual_trajectory, score:.score}} ]' "$TRAJ_PC1_TMP")"

  SESSION_ATTRS="$(jq -n \
    --arg agent "$AGENT" --arg pv "$PROMPT_VERSION" \
    --arg specid "$AGENT" --arg specver "$SPEC_VERSION" \
    --argjson agg "$(printf '%s' "$first_summary" | jq '.aggregate')" \
    --argjson n "$(printf '%s' "$first_summary" | jq '.n_cases')" \
    --argjson pass "$overall_pass" \
    '{agent:$agent, prompt_version:$pv, eval_spec:{id:$specid, version:$specver},
      "scores.aggregate":$agg, "scores.n_cases":$n, pass:$pass}')"

  # Carry pillars/reliability through VERBATIM when the run produced them (never re-derived or
  # relabeled here — in particular pillars.robustness keeps its narrow eval-run-log meaning: "no
  # case below per_case_min on the normal dataset", NOT a graceful-degradation score, per the
  # CR-089 re-gate caveat R3).
  if printf '%s' "$RESULT" | jq -e 'has("pillars")' >/dev/null 2>&1; then
    SESSION_ATTRS="$(printf '%s' "$SESSION_ATTRS" | jq --argjson p "$(printf '%s' "$RESULT" | jq -c '.pillars')" '. + {pillars:$p}')"
  fi
  if printf '%s' "$RESULT" | jq -e 'has("reliability")' >/dev/null 2>&1; then
    SESSION_ATTRS="$(printf '%s' "$SESSION_ATTRS" | jq --argjson r "$(printf '%s' "$RESULT" | jq -c '.reliability')" '. + {reliability:$r}')"
  fi

  TRACE_ID="${AGENT}-${PROMPT_VERSION}-$(date -u +%s)"
  TRACE="$(jq -n \
    --arg shape "devgenie.agent-run-trace/v1-scaffold" \
    --arg trace_id "$TRACE_ID" \
    --argjson session_attrs "$SESSION_ATTRS" \
    --argjson think "$THINK_SPANS" \
    --argjson tool "$TOOL_SPANS" \
    '{trace_shape:$shape, trace_id:$trace_id,
      "agent.session": {name:"agent.session", attributes:$session_attrs, spans:($think + $tool)}}')"
  printf '%s\n' "$TRACE" > "$TRACE_OUT"
fi

printf '%s\n' "$RESULT"
