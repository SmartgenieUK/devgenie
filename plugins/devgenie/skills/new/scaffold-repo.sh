#!/usr/bin/env bash
# scaffold-repo.sh — create a new governed DevGenie project skeleton. STRUCTURE ONLY;
# the methodology (foundation, rating, scaffold, slice) is delivered server-side per call
# by the devgenie-core MCP backend. This script ships no methodology IP.
set -euo pipefail

NAME=""; REGULATED=0; REMOTE=1; ORG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --regulated) REGULATED=1; shift ;;
    --no-remote) REMOTE=0; shift ;;
    --org) ORG="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$NAME" ] || { echo "usage: scaffold-repo.sh --name <project> [--regulated] [--no-remote] [--org <org>]" >&2; exit 2; }
[ -e "$NAME" ] && { echo "path '$NAME' already exists" >&2; exit 1; }

mkdir -p "$NAME/docs/inputs" "$NAME/.devgenie"
cd "$NAME"
git init -q

cat > .gitignore <<'EOF'
node_modules/
dist/
.env
.env.*
.claude/settings.local.json
EOF

cat > docs/inputs/README.md <<'EOF'
# docs/inputs — your brief

Drop your project brief here (one or more files): what you're building, for whom,
the constraints, the non-negotiables. `/devgenie:foundation` reads everything in
this folder to produce ARCH.md. Delete this README once you've added a real brief.
EOF

if [ "$REGULATED" = 1 ]; then REG=true; else REG=false; fi
cat > .devgenie/state.json <<EOF
{ "phase": "foundation_pending", "regulated": $REG }
EOF

cat > CLAUDE.md <<EOF
# $NAME — governed with DevGenie

Driven by the DevGenie loop. Run the commands in order; each one stops and hands off
to the next (the refusal is the product):

\`/devgenie:new\` -> \`/devgenie:foundation\` -> \`/devgenie:gate\` (fresh session) ->
\`/devgenie:scaffold\` -> \`/devgenie:slice\` (one per fresh session) · \`/devgenie:status\` anytime.

ACTIVE TASK: none

The methodology runs server-side in the DevGenie backend; this repo holds your own
artifacts (ARCH.md, assumptions, slices) and the evidence trail.
EOF

if [ "$REGULATED" = 1 ]; then
cat > GOVERNANCE.md <<EOF
# Governance — $NAME

Regulated project. Every phase leaves an attributable, evidence-backed artifact;
the rating gate is independent and (on Pro) signed. See \`.devgenie/gate.json\` and,
on Pro+, the server-side decision trail.
EOF
fi

git add -A
git commit -q -m "chore: DevGenie governance baseline" \
  || { echo "commit failed — is your git identity configured (user.name / user.email)?" >&2; exit 1; }
echo "created $NAME (phase: foundation_pending)"

if [ "$REMOTE" = 1 ]; then
  if command -v gh >/dev/null 2>&1; then
    # Resolve the GitHub org — NEVER hardcoded. Precedence: --org flag > plugin userConfig
    # (CLAUDE_PLUGIN_OPTION_ORG) > the first-run sink ~/.devgenie/config.json (.org) > the
    # authenticated gh user's own login. If none resolves, stay local (never guess an org).
    [ -z "$ORG" ] && ORG="${CLAUDE_PLUGIN_OPTION_ORG:-}"
    if [ -z "$ORG" ] && [ -f "$HOME/.devgenie/config.json" ] && command -v jq >/dev/null 2>&1; then
      ORG="$(jq -r '.org // empty' "$HOME/.devgenie/config.json" 2>/dev/null | tr -d '\r')"
    fi
    [ -z "$ORG" ] && ORG="$(gh api user --jq .login 2>/dev/null || true)"
    if [ -z "$ORG" ]; then
      echo "warning: no GitHub org resolved (--org / plugin org / ~/.devgenie/config.json / gh auth) — staying local." >&2
    else
      gh repo create "$ORG/$NAME" --private --source=. --remote=origin --push 2>&1 \
        || echo "warning: 'gh repo create' failed — staying local." >&2
    fi
  else
    echo "warning: gh not found — staying local (pass --no-remote to silence)." >&2
  fi
fi
