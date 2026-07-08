#!/usr/bin/env bash
# append-hardening-slice.sh — general slice-appender: insert a slice block at a named anchor.
# Serves Tier-1 Hardening (default) AND Tier-2 Eval-Hardening (via --anchor / --template).
# Implements the FROZEN slice-template contract §4:
#   Anchor        — insert at a stable marker, never an arbitrary location.
#   Idempotency   — a second run is a loud no-op, never a silent double-append.
#   Non-destructive — only inserts at the anchor; never edits/reorders existing rows.
#   Fail loud     — a malformed template (missing a §2 section) or a missing anchor errors
#                   visibly and writes nothing; never a partial/silent append.
#
# Usage: append-hardening-slice.sh <path/to/TASK_INDEX.md> [--template <path>] [--anchor <NAME>]
#   --anchor <NAME>   anchor name without delimiters; default: SMARTFORGE:HARDENING-SLICE
#                     Tier-1 call (no --anchor) behaves EXACTLY as before.
#                     Tier-2 call: --anchor SMARTFORGE:EVAL-HARDENING-SLICE
#   --template <path> slice template to insert; default: _TEMPLATE.hardening.slice.md
# The target must already carry the anchor line (scaffold emits it).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$(cd "$SCRIPT_DIR/.." && pwd)"                       # this script lives in <kit>/scripts/
TEMPLATE="$KIT/templates/_TEMPLATE.hardening.slice.md"     # default; overridable for testing
ANCHOR_NAME="SMARTFORGE:HARDENING-SLICE"                   # default; overridable via --anchor

target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --template) TEMPLATE="${2-}"; shift 2 ;;
    --anchor)   ANCHOR_NAME="${2-}"; shift 2 ;;
    -*) echo "append-hardening-slice: unknown option '$1'" >&2; exit 1 ;;
    *)  target="$1"; shift ;;
  esac
done

# A non-empty anchor name is required — an empty --anchor would key the block on a
# blank marker (<!--  -->) and append silently; fail loud instead (no fail-quiet edge).
[ -n "$ANCHOR_NAME" ] || { echo "append-hardening-slice: --anchor requires a non-empty name" >&2; exit 1; }

# Derive the three marker strings from the anchor name.
ANCHOR="<!-- ${ANCHOR_NAME} -->"
BEGIN="<!-- ${ANCHOR_NAME}:BEGIN (appended by scaffold — do not edit) -->"
END="<!-- ${ANCHOR_NAME}:END -->"

[ -n "$target" ]  || { echo "append-hardening-slice: target TASK_INDEX.md path is required" >&2; exit 1; }
[ -f "$target" ]  || { echo "append-hardening-slice: target '$target' not found" >&2; exit 1; }
[ -f "$TEMPLATE" ] || { echo "append-hardening-slice: template '$TEMPLATE' not found" >&2; exit 1; }

# Fail loud on a malformed template — refuse BEFORE touching the target (slice-template.md §2/§5).
# These markers are shared across both the Tier-1 hardening and Tier-2 eval-hardening templates.
require_section() {
  grep -qF "$1" "$TEMPLATE" || { echo "append-hardening-slice: template malformed — missing required section: $1" >&2; exit 1; }
}
require_section '## Task: '
require_section '**Prompt Skeleton:**'
require_section '**Seams:**'
require_section '**Acceptance Criteria:**'
require_section '**Non-Functional Requirements:**'
require_section 'Performance budget:'
require_section 'Security posture:'
require_section 'Observability hooks:'
require_section 'Failure semantics:'
require_section 'Human gate (if any):'

# Idempotency — a slice block is already present → loud no-op, never a double-append.
if grep -qF "$BEGIN" "$target"; then
  echo "append-hardening-slice: slice '${ANCHOR_NAME}' already present in '$target' — skipping (idempotent no-op)." >&2
  exit 0
fi

# Anchor — must exist; a missing anchor is a loud failure, not an arbitrary append.
# `|| true` so a no-match (grep exit 1) doesn't abort under `set -euo pipefail` before
# the explanatory failure below — fail loud means a clear message, not a bare exit 1.
anchor_line="$(grep -nF "$ANCHOR" "$target" | head -1 | cut -d: -f1 || true)"
[ -n "$anchor_line" ] || { echo "append-hardening-slice: anchor '${ANCHOR}' not found in '$target' — cannot place the slice deterministically" >&2; exit 1; }

# Non-destructive insert: everything up to & including the anchor, then the marked block,
# then the remainder — existing rows are neither edited nor reordered.
tmp="$(mktemp)"
{
  sed -n "1,${anchor_line}p" "$target"
  echo "$BEGIN"
  cat "$TEMPLATE"
  echo "$END"
  sed -n "$((anchor_line + 1)),\$p" "$target"
} > "$tmp"
mv "$tmp" "$target"

echo "append-hardening-slice: slice '${ANCHOR_NAME}' appended to '$target' at the anchor."
