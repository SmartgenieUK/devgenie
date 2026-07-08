#!/usr/bin/env bash
# failure-to-case.sh — Quality-Flywheel Feedback step TEMPLATE.
#
# Turns ONE failing eval-run-log per-case row into a candidate golden-set case, mechanically.
# This IS the failure-to-case template — a deterministic fill-in-the-blanks stamp.
# It is deliberately NOT an automated miner and NOT an LLM-drafted candidate (both explicitly
# deferred until a later release earns them): it invents nothing, it just carries the
# original case's .input/.expected forward, stamps provenance, and lets a human decide the tier
# and review .expected before committing the line to a tier-bucket dataset file. See
# the quality-flywheel guide for the full Define -> Instrument -> Evaluate -> Feedback
# process this template is the Feedback step of.
#
# A per-case eval-run-log row (scores.per_case) is only {input, score} — it carries no
# .expected (see the eval-run-log contract §2a). So this template also takes the
# ORIGINAL dataset case (which has .input/.expected) the failure row's .input identifies, and
# merges the failing score + run provenance onto it.
#
# Usage:
#   failure-to-case.sh --case <original-case.json> --score <failing-score> \
#     --agent <agent-id> --prompt-version <x.y.z> [--run-id <id>] [--tier typical|edge|adversarial]
#
# Prints ONE candidate case JSON line to stdout. Writes nothing — the human appends it (after
# reviewing/adjusting .expected) to the appropriate tier-bucket dataset file themselves.
set -euo pipefail

fail() { echo "failure-to-case: $1" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || fail "jq not found on PATH."

CASE_FILE=""; SCORE=""; AGENT=""; PROMPT_VERSION=""; RUN_ID=""; TIER="edge"
while [ $# -gt 0 ]; do
  case "$1" in
    --case) CASE_FILE="${2:-}"; shift 2 ;;
    --score) SCORE="${2:-}"; shift 2 ;;
    --agent) AGENT="${2:-}"; shift 2 ;;
    --prompt-version) PROMPT_VERSION="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --tier) TIER="${2:-}"; shift 2 ;;
    -h|--help)
      echo "usage: failure-to-case.sh --case <original-case.json> --score <failing-score> --agent <id> --prompt-version <x.y.z> [--run-id <id>] [--tier typical|edge|adversarial]" >&2
      exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[ -n "$CASE_FILE" ] || fail "--case <original-case.json> is required"
[ -s "$CASE_FILE" ] || fail "--case file not found or empty: $CASE_FILE"
jq -e . "$CASE_FILE" >/dev/null 2>&1 || fail "--case file is not valid JSON: $CASE_FILE"
jq -e 'has("input") and has("expected")' "$CASE_FILE" >/dev/null 2>&1 \
  || fail "--case file must carry .input and .expected (the original dataset case that failed) — see the eval-harness README §2"

[ -n "$SCORE" ] || fail "--score <failing-score> is required (the eval-run-log per-case score that failed)"
jq -n --argjson s "$SCORE" -e '($s|type=="number")' >/dev/null 2>&1 || fail "--score must be a number: $SCORE"

[ -n "$AGENT" ] || fail "--agent is required"
[ -n "$PROMPT_VERSION" ] || fail "--prompt-version is required"
[ -n "$RUN_ID" ] || RUN_ID="unknown"

case "$TIER" in
  typical|edge|adversarial) ;;
  *) fail "--tier must be one of typical|edge|adversarial (got '$TIER')" ;;
esac

jq -n \
  --slurpfile c "$CASE_FILE" \
  --arg tier "$TIER" \
  --argjson score "$SCORE" \
  --arg agent "$AGENT" \
  --arg pv "$PROMPT_VERSION" \
  --arg run_id "$RUN_ID" \
  '($c[0]) as $case |
   { input: $case.input, expected: $case.expected, tier: $tier,
     tags: ["from-failure", ("agent:" + $agent), ("prompt:" + $pv), ("run:" + $run_id)],
     source_score: $score }'
