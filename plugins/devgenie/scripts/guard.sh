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
  intake)
    # Front door: docs/inputs/ must hold REAL material, not just the seed README that
    # scaffold writes (the known false-green). Thin presence — semantic adequacy is the
    # served intake rubric's job, not this guard's (CR-068).
    [ -d docs/inputs ] || block "docs/inputs/ missing — create it and add the raw brief / discovery notes."
    real=""
    for f in docs/inputs/*; do
      [ -f "$f" ] || continue                         # nullglob-safe: empty dir leaves the literal glob, skipped here
      [ "$(basename "$f")" = "README.md" ] && continue
      [ -s "$f" ] || continue
      real="$f"; break
    done
    [ -n "$real" ] || block "docs/inputs/ holds no real material (only the seed README / empty) — add your brief / discovery notes, then run /devgenie:intake."
    ok ;;
  foundation)
    # Ready to rate: intake passed AND ARCH.md + ASSUMPTIONS exist. A foundation may only be
    # rated if built from inputs that cleared the intake gate (CR-030 / CR-068) — so a
    # thin-input build can never reach a PASS marker.
    command -v jq >/dev/null 2>&1 || block "jq is required to read the intake marker — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq) and retry."
    [ -s .devgenie/intake.json ] || block "no intake result — run /devgenie:intake first (foundation refuses without a passed intake)."
    [ "$(jq -r '.gate // empty' .devgenie/intake.json 2>/dev/null || true)" = "intake" ] || block ".devgenie/intake.json is not an intake marker (missing gate==\"intake\") — re-run /devgenie:intake."
    [ "$(jq -r '.verdict // empty' .devgenie/intake.json 2>/dev/null || true)" = "PASS" ] || block "intake verdict is not PASS — supply the missing inputs and re-run /devgenie:intake."
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
    echo "usage: guard.sh <intake|foundation|scaffold|slice>" >&2
    exit 2 ;;
esac
