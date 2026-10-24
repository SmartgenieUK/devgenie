#!/usr/bin/env bash
# step-ledger.sh <step> <outcome> — appends one row to .devgenie/step-ledger.jsonl: {ts, step, outcome, project, task,
# tokens:null}. The served prompt names the step and outcome; task comes from CLAUDE.md's ACTIVE TASK line (else
# "unattributed") and project from the git root's name (else the current directory's). Token cost is reconciled at
# SessionEnd, never written here. Refuses, appending nothing, when a tool is missing, CLAUDE.md exists but cannot be
# read, git cannot read the repository, or the clock cannot be read.
set -euo pipefail

LEDGER=".devgenie/step-ledger.jsonl"

usage() {
  echo "usage: step-ledger.sh <step> <outcome>" >&2
  exit 2
}
refuse() {
  echo "DEVGENIE: $1; $LEDGER was not appended." >&2
  exit 1
}

[ "$#" -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || usage
step="$1"
outcome="$2"

for tool in date mkdir grep head sed basename git jq; do
  command -v "$tool" >/dev/null 2>&1 || refuse "$tool is required but was not found"
done

# The task: "no ACTIVE TASK line" and "could not read CLAUDE.md" are never confused.
task=""
if [ -e CLAUDE.md ] || [ -L CLAUDE.md ]; then
  { [ -f CLAUDE.md ] && [ -r CLAUDE.md ]; } || refuse "CLAUDE.md exists but cannot be read"
  rc=0
  line="$(grep -ioE 'ACTIVE TASK( POINTER)?:[[:space:]]*[^ ]+' CLAUDE.md)" || rc=$?
  [ "$rc" -le 1 ] || refuse "CLAUDE.md exists but cannot be read"
  if [ "$rc" -eq 0 ]; then
    task="$(printf '%s\n' "$line" | head -1 | sed -E 's/.*:[[:space:]]*//')"
  fi
fi
task="${task:-unattributed}"

# The project: the git root's name; outside a repository the current directory's; any other git failure refuses.
rc=0
gout="$(git rev-parse --show-toplevel 2>&1)" || rc=$?
if [ "$rc" -eq 0 ]; then
  proj="$(basename "$gout")"
elif [[ "$gout" == *"not a git repository"* ]]; then
  proj="$(basename "$(pwd)")"
else
  refuse "git could not read this repository (${gout%%$'\n'*})"
fi

ts="$(date -u +%FT%TZ)" || refuse "could not read the clock"
[ -n "$ts" ] || refuse "could not read the clock"

mkdir -p .devgenie
jq -nc --arg ts "$ts" --arg step "$step" --arg outcome "$outcome" --arg project "$proj" --arg task "$task" \
  '{ts:$ts, step:$step, outcome:$outcome, project:$project, task:$task, tokens:null}' \
  >> "$LEDGER"
