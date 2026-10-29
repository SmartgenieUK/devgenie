#!/usr/bin/env bash
# guard.sh — DevGenie gate primitive. "The refusal is the product."
# Verifies REAL artifacts on disk, never a state.json flag, so a hand-edited state
# file can never be used to skip a gate. Prints a clear reason and exits non-zero on block.
set -euo pipefail

phase="${1:-}"
here="$(cd "$(dirname "$0")" && pwd)"   # the plugin's scripts/, resolved before we leave it (keys/ sits beside it)
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

block() { echo "GATE BLOCKED ($phase): $1" >&2; exit 1; }
ok()    { echo "GATE OK: $phase"; }

# Honest dependency check (BUG-03, as client/guard.sh): a tool missing from this session's PATH may still be
# installed (the stale-PATH case right after an install), so probe the common locations before saying "install".
# Both outcomes block. DEVGENIE_DEP_DIRS (colon-separated) overrides the probe list.
dep_check() {
  command -v "$1" >/dev/null 2>&1 && return 0
  local d OLDIFS="$IFS"; IFS=:
  for d in ${DEVGENIE_DEP_DIRS:-/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/mingw64/bin:/c/ProgramData/chocolatey/bin:/c/Program Files/Git/usr/bin}; do
    [ -n "$d" ] || continue
    if [ -x "$d/$1" ] || [ -x "$d/$1.exe" ]; then IFS="$OLDIFS"; block "$1 is installed but not visible to this session — restart Claude Code (do not reinstall)."; fi
  done
  IFS="$OLDIFS"
  block "$1 is required but not installed — it ships with Git for Windows, macOS and most Linux distributions; install it and retry."
}

# CR-210 row 8, shared by the foundation and scaffold phases: the intake result must carry DevGenie's signed receipt,
# the receipt must verify against a key bundled with the plugin over the exact bytes the server signs
# (canonicalIntakeReceipt), and only then does PASS or CONDITIONAL unlock. A result without a verifying receipt blocks
# (owner ruling HITL-017 as superseded: the old intake is discontinued). Needs jq (the caller checks it). Leaves $tmp
# (removed on exit) for the caller to reuse.
intake_receipt() {
  [ -s .devgenie/intake.json ] || block "no intake result — run /devgenie:intake first ($phase refuses without a passed intake)."
  [ "$(jq -r '.gate // empty' .devgenie/intake.json 2>/dev/null || true)" = "intake" ] || block ".devgenie/intake.json is not an intake marker (missing gate==\"intake\") — re-run /devgenie:intake."
  dep_check openssl
  dep_check base64
  sig="$(jq -r '.receipt.signature? // empty' .devgenie/intake.json 2>/dev/null || true)"
  [ -n "$sig" ] || block "the intake result has no signed receipt — re-run /devgenie:intake (a result recorded before plugin 0.3.7 needs one re-run)."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  # The server's sort is JavaScript's (UTF-16 code units); jq's sort is by code point. u16 is the sort key that
  # makes them agree: a code point above U+FFFF becomes its surrogate pair.
  # js writes JSON.stringify's bytes: jq's own escaping is identical except that it escapes U+007F, which
  # JSON.stringify writes raw, so each string is escaped by jq between its U+007F characters.
  defs='def u16: [explode[] | if . > 65535 then ((. - 65536) / 1024 | floor) + 55296, ((. - 65536) % 1024) + 56320 else . end];
    def cites: [.[] | [.file, .line]] | sort_by((.[0] | u16), .[1]);
    def js: if type == "array" then "[" + (map(js) | join(",")) + "]"
      elif type == "string" then "\"" + (split("\u007f") | map(tojson | .[1:-1]) | join("\u007f")) + "\""
      else tojson end;'
  # cardDigest: the card in question order, values, choices and citations sorted.
  jq -j "$defs"' .card as $c | [("solution_type", "industry_vertical", "users", "data_handled", "regulations",
      "existing_estate", "preferences", "delivery_shape", "ai_use") as $k | $c[$k] as $a |
    if $a.status != "answered" then [$k, $a.status, []]
    elif ($a.choices | type) == "array" then [$k, $a.status, ([$a.choices[] | [.force, .value, (.citations | cites)] | js] | sort_by(u16))]
    else [$k, $a.status, [($a.values | sort_by(u16)), ($a.citations | cites)]] end] | js' \
    .devgenie/intake.json > "$tmp/card.bin" 2>/dev/null || block "the intake result's card cannot be read — re-run /devgenie:intake."
  card="$(openssl dgst -sha256 < "$tmp/card.bin")"; card="${card%$'\r'}"; card="${card##* }"
  [[ "$card" =~ ^[0-9a-f]{64}$ ]] || block "could not hash the intake result's card with openssl."
  # canonicalIntakeReceipt: a fixed-order JSON array, rebuilt from the marker alone.
  jq -j --arg card "$card" "$defs"' ["devgenie-intake-receipt", 2, .rule_version, .bank_version, .verdict, .starting_type,
      .depth, .facts.personal_data, .facts.regulated_data, .facts.governed_industry, .facts.volume_stated,
      .facts.multi_customer, .facts.agent_track, .receipt.ratings_sha256, .receipt.card_sha256, $card,
      .open_for_foundation, .next_gap.element, .next_gap.rating, .receipt.receipt_id, .receipt.decided_at] | js' \
    .devgenie/intake.json > "$tmp/intake-payload.bin" 2>/dev/null || block "the intake result cannot be read — re-run /devgenie:intake."
  printf '%s' "$sig" | base64 -d > "$tmp/intake-sig.bin" 2>/dev/null || block "the intake result's signature is malformed — re-run /devgenie:intake."
  # The keys bundled with the plugin, as for the gate; never a key from the marker, the environment or the network.
  local k have_key="" verified=""
  for k in "$here/../keys/"*.pem; do
    [ -f "$k" ] || continue
    have_key=1
    if openssl dgst -sha256 -verify "$k" -signature "$tmp/intake-sig.bin" "$tmp/intake-payload.bin" >/dev/null 2>&1; then verified=1; break; fi
  done
  [ -n "$have_key" ] || block "this plugin install has no gate key — reinstall the plugin."
  [ -n "$verified" ] || block "the intake result's receipt does not verify — it was edited or not issued by DevGenie; re-run /devgenie:intake."
  local v
  v="$(jq -r '.verdict' .devgenie/intake.json)"
  [ "$v" = "PASS" ] || [ "$v" = "CONDITIONAL" ] || block "intake verdict is '$v' — supply what intake asks for and re-run /devgenie:intake."
}

case "$phase" in
  intake)
    # Front door: docs/inputs/ must hold REAL material, not just the seed README that
    # scaffold writes (the known false-green). Thin presence — semantic adequacy is the
    # served intake rubric's job, not this guard's.
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
  intake-receipt)
    # The check before drafting (the foundation skill's step 1): a signed intake result, PASS or CONDITIONAL; no ARCH.md yet.
    command -v jq >/dev/null 2>&1 || block "jq is required to read the intake marker — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq) and retry."
    intake_receipt
    ok ;;
  foundation)
    # Ready to rate: intake passed AND ARCH.md + ASSUMPTIONS exist. A foundation may only be
    # rated if built from inputs that cleared the intake gate — so a
    # thin-input build can never reach a PASS marker.
    command -v jq >/dev/null 2>&1 || block "jq is required to read the intake marker — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq) and retry."
    intake_receipt
    [ -s ARCH.md ] || block "ARCH.md is missing or empty — run /devgenie:foundation first."
    [ -s docs/ASSUMPTIONS.md ] || block "docs/ASSUMPTIONS.md is missing or empty."
    ok ;;
  scaffold)
    command -v jq >/dev/null 2>&1 || block "jq is required but not installed — install it (macOS: brew install jq · Windows: winget install jqlang.jq · Linux: apt-get install jq)."
    # CR-210 row 8: a signed gate result does not prove a verified intake (the rating never reads the receipt), so
    # scaffold checks the intake receipt itself, before the gate. The gate's files go in the same $tmp.
    intake_receipt
    [ -s .devgenie/gate.json ] || block "no rating verdict — run /devgenie:gate first."
    # BUG-09 (contract §4.4): DevGenie signs every gate result; the guard holds the public key only, so it can
    # confirm a PASS but never forge one. A hand-written or hand-edited result does not verify and blocks.
    dep_check openssl
    dep_check base64
    v="$(jq -r '.verdict' .devgenie/gate.json)"
    ind="$(jq -r '.independent' .devgenie/gate.json)"
    [ "$v" = "PASS" ] || block "rating verdict is '$v', not PASS — address the scorecard in /devgenie:foundation."
    [ "$ind" = "true" ] || block "the gate was not independent — re-run /devgenie:gate in a fresh session."
    scope="$(jq -r '.scope // empty' .devgenie/gate.json)"
    [ "$scope" = "mvp" ] || [ "$scope" = "production" ] || block "the gate result has an unknown scope '$scope' — re-run /devgenie:gate."
    sig="$(jq -r '.signature // empty' .devgenie/gate.json)"
    [ -n "$sig" ] || block "the gate result is not signed — re-run /devgenie:gate with this plugin version (results recorded before 0.3.1 need one re-rate)."
    # The exact signed bytes (the server's canonicalGate, as client/guard.sh rebuilds them): nine elements on a
    # v1.9+ result, eight on an older one; jq -cj matches the server's JSON.stringify byte for byte.
    jq -cj 'if has("arch_sha256") then [.verdict,.independent,.scope,.grade,.receipt_id,.project,.rated_at,.methodology_version,.arch_sha256] else [.verdict,.independent,.scope,.grade,.receipt_id,.project,.rated_at,.methodology_version] end' \
      .devgenie/gate.json > "$tmp/payload.bin"
    printf '%s' "$sig" | base64 -d > "$tmp/sig.bin" 2>/dev/null || block "the gate result's signature is malformed — re-run /devgenie:gate."
    # The pinned keys bundled with the plugin (current plus grace); never a key from the marker, the environment
    # or the network. Any one verifying unlocks.
    have_key="" verified=""
    for k in "$here/../keys/"*.pem; do
      [ -f "$k" ] || continue
      have_key=1
      if openssl dgst -sha256 -verify "$k" -signature "$tmp/sig.bin" "$tmp/payload.bin" >/dev/null 2>&1; then verified=1; break; fi
    done
    [ -n "$have_key" ] || block "this plugin install has no gate key — reinstall the plugin."
    [ -n "$verified" ] || block "the gate result's signature does not verify — it was edited or not issued by DevGenie; re-run /devgenie:gate."
    # The scope the caller is about to request (optional second argument): an mvp result unlocks mvp only.
    want="${2:-}"
    case "$want" in
      ""|mvp) ;;
      production) [ "$scope" = "production" ] || block "the gate result covers mvp only — re-run /devgenie:gate at production scope before a production scaffold." ;;
      *) block "unknown scaffold scope '$want'" ;;
    esac
    echo "UNLOCK $scope" ;;
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
    # eval harness runner AND a versioned prompt (prompt v1.0). The server's scaffold_agent writes the
    # runner at evals/run-evals.sh; evals/<agent>/run-evals.sh is the pre-0.3.0 layout.
    have_runner=""
    for f in evals/run-evals.sh evals/*/run-evals.sh; do
      [ -s "$f" ] || continue
      have_runner="$f"; break
    done
    have_prompt=""
    for f in prompts/*.v*.md; do
      [ -s "$f" ] || continue
      have_prompt="$f"; break
    done
    [ -n "$have_runner" ] || block "no eval harness (evals/run-evals.sh) — run /devgenie:agent-scaffold first."
    [ -n "$have_prompt" ] || block "no versioned prompt (prompts/<agent>.v*.md) — run /devgenie:agent-scaffold first."
    ok ;;
  *)
    echo "usage: guard.sh <intake|intake-receipt|foundation|scaffold|slice|agent-foundation|agent-scaffold|agent-slice>" >&2
    exit 2 ;;
esac
