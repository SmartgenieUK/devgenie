#!/usr/bin/env bash
# validate-agent-specs.sh <agent> — checks <agent>.eval-spec.json and <agent>.agent-spec.json in the current directory
# against their frozen contracts (eval-spec/v1, agent-spec/v1, including the prompt_contract key whitelist). Prints
# "eval-spec contract OK" / "agent-spec contract OK" for each spec that conforms; exits 0 only when both do. A spec
# that does not conform is named on stderr. A schema check, not a rating rule.
set -euo pipefail

usage() {
  echo "usage: validate-agent-specs.sh <agent>" >&2
  exit 2
}
[ "$#" -eq 1 ] && [ -n "$1" ] || usage
agent="$1"

command -v jq >/dev/null 2>&1 || { echo "DEVGENIE: jq is required but was not found; nothing was checked." >&2; exit 1; }

failed=0

# eval-spec — FROZEN eval-spec/v1 (devgenie methodology/docs/contracts/eval-spec.md §3)
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
' "$agent.eval-spec.json" >/dev/null && echo "eval-spec contract OK" ||
  { failed=1; echo "DEVGENIE: $agent.eval-spec.json does not conform to eval-spec/v1." >&2; }

# agent-spec — FROZEN agent-spec/v1 (devgenie methodology/docs/contracts/agent-spec.md §4)
# the last clause is the crown-jewel key-whitelist: prompt_contract may carry ONLY version + must
jq -e '
  .schema=="agent-spec/v1"
  and (.agent|type=="string")
  and (.tools|type=="array") and (all(.tools[]; (.name|type=="string") and (.purpose|type=="string")))
  and (.io.input|type=="object") and (.io.output|type=="object")
  and (.prompt_contract.version|type=="string" and length>0)
  and (.prompt_contract.must|type=="array" and length>0)
  and (.guardrails|type=="array" and length>0)
  and ((.prompt_contract|keys) as $k | ($k|map(select(.=="version" or .=="must"))|length) == ($k|length))
' "$agent.agent-spec.json" >/dev/null && echo "agent-spec contract OK" ||
  { failed=1; echo "DEVGENIE: $agent.agent-spec.json does not conform to agent-spec/v1." >&2; }

exit "$failed"
