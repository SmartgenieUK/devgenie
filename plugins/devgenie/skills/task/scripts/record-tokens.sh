#!/usr/bin/env bash
# .claude/hooks/record-tokens.sh - append one token-ledger row per finished session (SessionEnd hook).
#
# The row's `task` is the name on the "ACTIVE TASK:" line of CLAUDE.md; with no such line it is `none`.
# The row shape is fixed and the server validates it exactly: eight fields, six of them non-empty
# strings, `by_model` naming at least one model. A row missing any of them is refused with
# SCHEMA_MISMATCH, so a short row is not a partial record, it is no record.
#
# The whole row is assembled INSIDE jq. Nothing here does shell arithmetic on a tool's output: jq
# built for Windows writes CRLF, `9\r` is not a number, and under `set -e` that killed this hook
# before it wrote anything at all.
set -euo pipefail
input=$(cat)

# Never fail a session end: an event that is not JSON writes nothing and exits 0.
if ! jq -e . <<<"$input" >/dev/null 2>&1; then exit 0; fi

transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session=$(jq -r '.session_id // empty' <<<"$input")
proj="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$input")}"
if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then exit 0; fi
# The off switch: DEVGENIE_TASK_POINTER=off, or the file .devgenie/task-pointer.off in the project.
if [ "${DEVGENIE_TASK_POINTER:-}" = "off" ] || [ -f "$proj/.devgenie/task-pointer.off" ]; then exit 0; fi
if [ -z "$session" ]; then session="unknown"; fi

# Every optional lookup below ends in `|| true`. Under `set -euo pipefail` a grep that matches
# nothing fails the pipeline, and a failed command substitution in an assignment exits the script,
# so a project with no CLAUDE.md would record nothing instead of recording `none`.
task=$(grep -ioE 'ACTIVE TASK( POINTER)?:[[:space:]]*[^[:space:]]+' "$proj/CLAUDE.md" 2>/dev/null \
        | grep -oE '[^[:space:]]+$' | head -n1 || true)
task="${task:-none}"

# user_email is a PROXY and is named as one: plugin option, then the ~/.devgenie identity sink, then
# the git committer identity, then the OS user. Never invented, and `git config --global` is never written.
user_email="${CLAUDE_PLUGIN_OPTION_USER_EMAIL:-}"
if [ -z "$user_email" ]; then
  user_email=$(jq -r '.user_email // empty' "$HOME/.devgenie/config.json" 2>/dev/null || true)
fi
if [ -z "$user_email" ]; then user_email=$(git -C "$proj" config user.email 2>/dev/null || true); fi
if [ -z "$user_email" ]; then user_email="${USER:-${USERNAME:-unknown}}"; fi

host=$(hostname 2>/dev/null || true); host="${host:-unknown}"

project=$(jq -r '.project // empty' "$proj/.devgenie/state.json" 2>/dev/null || true)
if [ -z "$project" ]; then project=$(basename "$proj"); fi

# A session can touch more than one model, so usage is grouped by message.model into by_model and
# tokens.* is the roll-up across all of them. `select(length > 0)` is why a transcript with no
# assistant turns writes NOTHING: a row attributing spend to no model is refused by the server.
mkdir -p "$proj/metrics"
jq -s -c \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg user_email "$user_email" \
  --arg hostname "$host" \
  --arg project "$project" \
  --arg task "$task" \
  --arg session "$session" \
  '
  ( reduce ( .[] | select(.type == "assistant") ) as $m ({};
      ( $m.message.model // "unknown" ) as $k
      | ( $m.message.usage // {} ) as $u
      | .[$k] = {
          input:          ( ( .[$k].input          // 0 ) + ( $u.input_tokens                // 0 ) ),
          output:         ( ( .[$k].output         // 0 ) + ( $u.output_tokens               // 0 ) ),
          cache_creation: ( ( .[$k].cache_creation // 0 ) + ( $u.cache_creation_input_tokens // 0 ) ),
          cache_read:     ( ( .[$k].cache_read     // 0 ) + ( $u.cache_read_input_tokens     // 0 ) )
        } )
  ) as $by
  | ( reduce ( $by | to_entries[] ) as $e
        ( { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
          { input:          ( .input          + $e.value.input ),
            output:         ( .output         + $e.value.output ),
            cache_creation: ( .cache_creation + $e.value.cache_creation ),
            cache_read:     ( .cache_read     + $e.value.cache_read ) } )
  ) as $t
  | { ts: $ts, user_email: $user_email, hostname: $hostname, project: $project,
      task: $task, session: $session, by_model: $by,
      tokens: ( $t + { total_billed: ( $t.input + $t.output + $t.cache_creation + $t.cache_read ) } ) }
  | select( ( .by_model | length ) > 0 )
  ' "$transcript" | tr -d '\r' >> "$proj/metrics/token-ledger.jsonl" || true

# Refresh the per-task report so it includes this session, only when task-report.mjs is in our install record
# with the hash we installed (never execute a colliding or modified script). Best effort: never changes exit status.
report="$proj/.claude/hooks/task-report.mjs"
expected_sha=$(jq -r '.files["task-report.mjs"] // empty' "$proj/.devgenie/task-pointer.json" 2>/dev/null | tr -d '\r' || true)
actual_sha=""
if [ -n "$expected_sha" ] && [ -f "$report" ]; then
  actual_sha=$(node -e 'const {createHash}=require("node:crypto"),{readFileSync}=require("node:fs");process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$report" 2>/dev/null || true)
fi
if [ -n "$expected_sha" ] && [ "$actual_sha" = "$expected_sha" ]; then
  node "$report" "$proj" >/dev/null 2>&1 || true
fi
exit 0
