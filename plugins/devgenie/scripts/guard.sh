#!/usr/bin/env bash
# guard.sh — DevGenie gate primitive. "The refusal is the product."
# Verifies REAL artifacts on disk, never a state.json flag, so a hand-edited state
# file can never be used to skip a gate. Prints a clear reason and exits non-zero on block.
set -euo pipefail

phase="${1:-}"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

block() { echo "GATE BLOCKED ($phase): $1" >&2; exit 1; }
ok()    { echo "GATE OK: $phase"; }

case "$phase" in
  foundation)
    [ -s ARCH.md ] || block "ARCH.md is missing or empty — run /devgenie:foundation first."
    [ -s docs/ASSUMPTIONS.md ] || block "docs/ASSUMPTIONS.md is missing or empty."
    ok ;;
  scaffold)
    command -v jq >/dev/null 2>&1 || block "jq is required but not installed — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq)."
    [ -s .devgenie/gate.json ] || block "no rating verdict — run /devgenie:gate first."
    v="$(jq -r '.verdict' .devgenie/gate.json)"
    ind="$(jq -r '.independent' .devgenie/gate.json)"
    [ "$v" = "PASS" ] || block "rating verdict is '$v', not PASS — address the scorecard in /devgenie:foundation."
    [ "$ind" = "true" ] || block "the gate was not independent — re-run /devgenie:gate in a fresh session."
    ok ;;
  slice)
    [ -d contracts ] || block "no contracts/ directory — run /devgenie:scaffold first."
    [ -s docs/TASK_INDEX.md ] || block "docs/TASK_INDEX.md is missing or empty."
    [ -z "$(git status --porcelain)" ] || block "working tree is not clean — commit or stash before a slice (Definition of Ready)."
    ok ;;
  *)
    echo "usage: guard.sh <foundation|scaffold|slice>" >&2
    exit 2 ;;
esac
