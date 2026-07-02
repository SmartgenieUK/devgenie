#!/usr/bin/env bash
# record-tokens.sh — append one token-ledger row per task-session.
# Installed into a project's .claude/hooks/ by /devgenie:scaffold.
# SessionEnd has no decision control; this is logging only and never blocks shutdown.
# Canonical and identical across every DevGenie project, so the benchmark is comparable.
set -euo pipefail
input=$(cat)

# Claude Code hands this hook host (Windows) paths like C:\...\x.jsonl. Whatever
# bash runs the hook (WSL, MSYS/Git Bash, Cygwin) cannot stat a C:\ path, so every
# file test below would silently fail. Convert host paths to this bash's native form
# first. wslpath (WSL) -> cygpath (MSYS/Cygwin) -> passthrough (already-native input).
to_unix() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) command -v wslpath >/dev/null 2>&1 && wslpath -u "$1" 2>/dev/null || printf '%s' "$1" ;;
  esac
}

transcript=$(jq -r '.transcript_path // empty' <<<"$input")
session=$(jq -r '.session_id // empty' <<<"$input")
proj="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$input")}"
proj="$(to_unix "$proj")"

# No-ops must be loud (to stderr), never a silent exit 0 — a quiet skip is what hides
# path bugs and leaves the ledger empty for an entire slice.
if [ -z "$transcript" ]; then
  echo "record-tokens: no transcript_path in event — skipping" >&2; exit 0
fi
transcript="$(to_unix "$transcript")"
if [ ! -f "$transcript" ]; then
  echo "record-tokens: transcript not found at '$transcript' — skipping" >&2; exit 0
fi

# Active task from CLAUDE.md's active-task pointer (fallback: 'unattributed').
task=$(grep -ioE 'ACTIVE TASK( POINTER)?:\s*\S+' "$proj/CLAUDE.md" 2>/dev/null \
        | grep -oE '\S+$' | head -n1)
task="${task:-unattributed}"

# Chargeback attribution. These are proxies, not verified identity/assets:
#  - user_email is a captured/committer identity (NOT a verified login).
#  - host is the machine name (a proxy for device).
#  - project prefers .devgenie/state.json, falls back to the directory name.
# Precedence for user_email: 1) plugin userConfig env, 2) the first-run sink
# ~/.devgenie/config.json, 3) git committer identity, 4) the OS user. Named honestly as a proxy.
user_email="${CLAUDE_PLUGIN_OPTION_USER_EMAIL:-}"
if [ -z "$user_email" ] && [ -f "$HOME/.devgenie/config.json" ]; then
  user_email="$(jq -r '.user_email // empty' "$HOME/.devgenie/config.json" 2>/dev/null | tr -d '\r')"
fi
[ -z "$user_email" ] && user_email="$(git -C "$proj" config user.email 2>/dev/null || true)"
user_email="${user_email:-$(whoami 2>/dev/null || echo unknown)}"
host="$(hostname 2>/dev/null || uname -n 2>/dev/null || echo unknown)"
project="$(jq -r '.project // empty' "$proj/.devgenie/state.json" 2>/dev/null || true)"
project="${project:-$(basename "$proj")}"

# build_phase — an OPTIONAL drill-down dimension, additive only. Derived from the
# state-machine cursor: 'building' -> production; any '*_pending' -> scaffold (setup);
# absent/unparseable -> field OMITTED. Never changes tokens.total_billed.
phase="$(jq -r '.phase // empty' "$proj/.devgenie/state.json" 2>/dev/null || true)"
case "$phase" in
  building)  build_phase="production" ;;
  *_pending) build_phase="scaffold" ;;
  *)         build_phase="" ;;
esac

# One chargeback-grade row per task-session. A session can touch >1 model, so usage is
# grouped by .message.model into by_model; tokens.* is the roll-up across all models.
# All arithmetic stays inside jq; a native-Windows jq's CRLF is stripped so the jsonl
# line ends in a clean LF.
mkdir -p "$proj/metrics"
jq -sc \
  --arg ts "$(date -u +%FT%TZ)" \
  --arg user_email "$user_email" \
  --arg hostname "$host" \
  --arg project "$project" \
  --arg task "$task" \
  --arg session "$session" \
  --arg build_phase "$build_phase" '
  [ .[] | select(.type=="assistant") | {model: (.message.model // "unknown"), u: (.message.usage // {})} ]
  | ( group_by(.model)
      | map({ key: .[0].model,
              value: (reduce .[] as $r ({input:0,output:0,cache_creation:0,cache_read:0};
                { input:(.input + ($r.u.input_tokens // 0)),
                  output:(.output + ($r.u.output_tokens // 0)),
                  cache_creation:(.cache_creation + ($r.u.cache_creation_input_tokens // 0)),
                  cache_read:(.cache_read + ($r.u.cache_read_input_tokens // 0)) })) })
      | from_entries ) as $by_model
  | ( [ $by_model[] ] | reduce .[] as $m ({input:0,output:0,cache_creation:0,cache_read:0};
        { input:(.input+$m.input), output:(.output+$m.output),
          cache_creation:(.cache_creation+$m.cache_creation), cache_read:(.cache_read+$m.cache_read) }) ) as $tot
  | ( { ts:$ts, user_email:$user_email, hostname:$hostname, project:$project, task:$task, session:$session }
      + (if $build_phase != "" then { build_phase:$build_phase } else {} end)
      + { by_model:$by_model,
          tokens: ($tot + { total_billed: ($tot.input+$tot.output+$tot.cache_creation+$tot.cache_read) }) } )
  ' "$transcript" | tr -d '\r' >> "$proj/metrics/token-ledger.jsonl"
exit 0
