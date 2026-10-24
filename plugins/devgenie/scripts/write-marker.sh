#!/usr/bin/env bash
# write-marker.sh — writes a DevGenie gate marker from the tool response the skill saved exactly as returned.
# It copies the fields the server returned and checks they are present; it holds no rating rule, and it never
# invents a value. The guards trust these files, so the model never types them.
#   write-marker.sh gate <response.json> <project>   -> .devgenie/gate.json (the server-signed fields, plus project and date)
#   write-marker.sh agent-gate <response.json>       -> .devgenie/agent-gate.json (the response's marker, unchanged)
set -euo pipefail

usage() {
  echo "usage: write-marker.sh gate <response.json> <project> | write-marker.sh agent-gate <response.json>" >&2
  exit 2
}

kind="${1:-}"
case "$kind" in
  gate) [ "$#" -eq 3 ] || usage; out=".devgenie/gate.json" ;;
  agent-gate) [ "$#" -eq 2 ] || usage; out=".devgenie/agent-gate.json" ;;
  *) usage ;;
esac
resp="$2"

refuse() {
  echo "DEVGENIE: $1 — $out was not written." >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || refuse "jq is not installed"
[ -f "$resp" ] || refuse "there is no saved response at $resp"
jq -e 'type == "object"' "$resp" >/dev/null 2>&1 || refuse "$resp is not a JSON object (save the tool's response exactly as returned)"

mkdir -p .devgenie
tmp="$(mktemp .devgenie/.marker.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

if [ "$kind" = gate ]; then
  project="$3"
  [ -n "$project" ] || refuse "the project name is empty (give the exact project you sent)"
  jq -e '(.verdict | IN("PASS", "CONDITIONAL", "FAIL")) and (.independent | type == "boolean")
    and (.scope | IN("mvp", "production"))
    and all(.grade, .receipt_id, .rated_at, .methodology_version, .arch_sha256, .signature; type == "string" and length > 0)' \
    "$resp" >/dev/null 2>&1 || refuse "the response is not a signed rating verdict (an error, or fields missing)"
  jq --arg project "$project" '{verdict, independent, scope, grade, receipt_id, project: $project, rated_at,
    methodology_version, arch_sha256, signature, date: .rated_at[0:10]}' "$resp" | tr -d '\r' >"$tmp" ||
    refuse "the marker could not be built"
else
  jq -e '.marker | type == "object" and (.verdict | IN("PASS", "CONDITIONAL", "FAIL")) and (.grade | type == "string")
    and (.independent | type == "boolean") and (.date | type == "string")' "$resp" >/dev/null 2>&1 ||
    refuse "the response carries no Tier-2 gate marker (an error, or fields missing)"
  jq '.marker' "$resp" | tr -d '\r' >"$tmp" || refuse "the marker could not be built"
fi
mv -f "$tmp" "$out"
echo "DEVGENIE: wrote $out."
