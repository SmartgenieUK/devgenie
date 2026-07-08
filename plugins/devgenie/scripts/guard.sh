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
  agent-foundation)
    # Tier-2 analogue of `foundation` (run by agent-gate): the eval spec AND agent spec must
    # exist & be non-empty before the Tier-2 gate can rate them. Filenames are
    # <agent>.eval-spec.json / <agent>.agent-spec.json (agent-id varies) — accept any.
    # Presence only; schema conformance is rate_agent_foundation's job, server-side.
    have_eval=""
    for f in *.eval-spec.json; do
      [ -s "$f" ] || continue
      have_eval="$f"; break
    done
    have_agent=""
    for f in *.agent-spec.json; do
      [ -s "$f" ] || continue
      have_agent="$f"; break
    done
    [ -n "$have_eval" ]  || block "no <agent>.eval-spec.json — run /devgenie:agent-foundation first (nothing to rate)."
    [ -n "$have_agent" ] || block "no <agent>.agent-spec.json — run /devgenie:agent-foundation first (nothing to rate)."
    ok ;;
  agent-scaffold)
    # Tier-2 crown jewel: cannot scaffold an agent until an INDEPENDENT Tier-2 gate recorded
    # a PASS (analogue of `scaffold`). Reads .devgenie/agent-gate.json.
    command -v jq >/dev/null 2>&1 || block "jq is required but not installed — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq)."
    [ -s .devgenie/agent-gate.json ] || block "no Tier-2 rating-gate result — run /devgenie:agent-gate in a fresh session first."
    v="$(jq -r '.verdict // empty' .devgenie/agent-gate.json)"
    ind="$(jq -r '.independent // empty' .devgenie/agent-gate.json)"
    [ "$v" = "PASS" ] || block "Tier-2 gate verdict is '$v', not PASS — address the scorecard in /devgenie:agent-foundation."
    [ "$ind" = "true" ] || block "Tier-2 gate result is not marked independent — re-run /devgenie:agent-gate in a fresh session."
    ok ;;
  agent-slice)
    # Ready to run the prompt->eval->revise loop: the Tier-2 Phase-0 scaffold must exist — an
    # eval harness runner AND a versioned prompt (prompt v1.0).
    have_runner=""
    for f in evals/*/run-evals.sh; do
      [ -s "$f" ] || continue
      have_runner="$f"; break
    done
    have_prompt=""
    for f in prompts/*.v*.md; do
      [ -s "$f" ] || continue
      have_prompt="$f"; break
    done
    [ -n "$have_runner" ] || block "no eval harness (evals/<agent>/run-evals.sh) — run /devgenie:agent-scaffold first."
    [ -n "$have_prompt" ] || block "no versioned prompt (prompts/<agent>.v*.md) — run /devgenie:agent-scaffold first."
    ok ;;
  *)
    echo "usage: guard.sh <intake|foundation|scaffold|slice|agent-foundation|agent-scaffold|agent-slice>" >&2
    exit 2 ;;
esac
