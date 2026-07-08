#!/usr/bin/env bash
# scaffold-agent.sh — Tier-2 tool-definition + prompt-skeleton scaffold.
#
# Reads a FROZEN agent-spec/v1 JSON file and emits into an output directory:
#   tools/<name>.tool.md   — one stub per tool in tools[] (builder fills the impl)
#   prompts/<agent>.v<version>.md — prompt skeleton: must-items as headings only
#
# CROWN-JEWEL INVARIANT (agent-spec.md §3):
#   The prompt skeleton is STRUCTURE ONLY — headings, must-items, TODO placeholders.
#   This script NEVER writes actual system/agent/rating prompt text.
#   The agent-spec is NEVER modified — it is read-only input.
#   Any field beyond "version"/"must" in prompt_contract is a crown-jewel violation;
#   this script validates and rejects such a spec before emitting anything.
#
# Usage:
#   bash scaffold-agent.sh <agent-spec.json> [<out-dir>]
#
#   <agent-spec.json>  — path to a validated agent-spec/v1 JSON file
#   <out-dir>          — destination directory (default: current working directory)
#
# Behaviour:
#   - Validates the spec against the FROZEN agent-spec/v1 contract before any emit.
#   - Emits tools/<name>.tool.md for each entry in tools[].
#   - Emits prompts/<agent>.v<version>.md as a skeleton (must-items as headings).
#   - Idempotent: if the prompt skeleton already exists, skips with a notice (non-destructive).
#   - Tool stubs are also non-destructive: existing files are skipped with a notice.
#   - Fails loud on any validation error, missing dep, or missing input.
#
# Dependencies: bash, jq

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
fail()  { echo "scaffold-agent: ERROR: $*" >&2; exit 1; }
notice(){ echo "scaffold-agent: $*"; }
warn()  { echo "scaffold-agent: WARNING: $*" >&2; }

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
command -v jq >/dev/null 2>&1 || fail "jq not found on PATH — install jq and retry."

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
spec_file="${1:-}"
out_dir="${2:-$(pwd)}"

[ -n "$spec_file" ] || {
  echo "Usage: bash scaffold-agent.sh <agent-spec.json> [<out-dir>]" >&2
  echo ""                                                              >&2
  echo "  <agent-spec.json>  path to a validated agent-spec/v1 JSON" >&2
  echo "  <out-dir>          output directory (default: cwd)"         >&2
  exit 1
}
[ -f "$spec_file" ] || fail "agent-spec file '$spec_file' not found."

# ---------------------------------------------------------------------------
# Validation — FROZEN agent-spec/v1 contract (agent-spec.md §4 + §3 crown-jewel)
# ---------------------------------------------------------------------------
# Run the exact jq expression from the contract document; any failure = non-conforming spec.
notice "Validating '$spec_file' against the FROZEN agent-spec/v1 contract..."

jq_contract='
  .schema=="agent-spec/v1"
  and (.agent|type=="string" and length>0)
  and (.tools|type=="array")
  and (all(.tools[]; (.name|type=="string" and length>0) and (.purpose|type=="string" and length>0)))
  and (.io.input|type=="object")
  and (.io.output|type=="object")
  and (.prompt_contract.version|type=="string" and length>0)
  and (.prompt_contract.must|type=="array" and length>0)
  and (.guardrails|type=="array" and length>0)
  and ((.prompt_contract|keys) as $k |
       ($k | map(select(. == "version" or . == "must")) | length) == ($k | length))
'

# CROWN-JEWEL check is the last clause above: prompt_contract may carry ONLY "version" and "must".
# Any extra key (text, body, system, prompt, ...) is a contract violation and we refuse to scaffold.

validation_result="$(jq -r "if (${jq_contract}) then \"OK\" else \"FAIL\" end" "$spec_file" 2>&1)" \
  || fail "jq failed while validating '$spec_file': ${validation_result}"

if [ "$validation_result" != "OK" ]; then
  # Emit a targeted diagnosis before failing
  schema="$(jq -r '.schema // "(missing)"' "$spec_file" 2>/dev/null || echo "(unreadable)")"
  agent="$(jq -r '.agent // "(missing)"' "$spec_file" 2>/dev/null || echo "(unreadable)")"
  pc_keys="$(jq -r '(.prompt_contract // {}) | keys | join(", ")' "$spec_file" 2>/dev/null || echo "(unreadable)")"
  echo "scaffold-agent: VALIDATION FAILED for '$spec_file'" >&2
  echo "  schema:              $schema (must be \"agent-spec/v1\")" >&2
  echo "  agent:               $agent" >&2
  echo "  prompt_contract keys: $pc_keys (must be ONLY: version, must)" >&2
  echo "" >&2
  echo "  CROWN-JEWEL: prompt_contract may carry only 'version' and 'must'." >&2
  echo "  Any extra key (text, body, system, prompt, ...) leaks protected IP." >&2
  echo "  Fix the agent-spec and retry. scaffold-agent refuses non-conforming specs." >&2
  exit 1
fi

notice "Validation PASSED (agent-spec/v1 contract OK, crown-jewel check OK)."

# ---------------------------------------------------------------------------
# Extract fields
# ---------------------------------------------------------------------------
agent_id="$(jq -r '.agent' "$spec_file")"
prompt_version="$(jq -r '.prompt_contract.version' "$spec_file")"
tools_count="$(jq '.tools | length' "$spec_file")"

notice "Agent:          $agent_id"
notice "Prompt version: $prompt_version"
notice "Tools:          $tools_count"
notice "Output dir:     $out_dir"

# ---------------------------------------------------------------------------
# Prepare output directories
# ---------------------------------------------------------------------------
tools_dir="$out_dir/tools"
prompts_dir="$out_dir/prompts"
mkdir -p "$tools_dir" "$prompts_dir"

# ---------------------------------------------------------------------------
# Emit tool-definition stubs (one file per tool; idempotent + non-destructive)
# ---------------------------------------------------------------------------
notice "--- Emitting tool stubs ---"

emitted_tools=()
skipped_tools=()

while IFS= read -r tool_json; do
  tool_name="$(echo "$tool_json" | jq -r '.name')"
  tool_purpose="$(echo "$tool_json" | jq -r '.purpose')"
  stub_file="$tools_dir/${tool_name}.tool.md"

  if [ -f "$stub_file" ]; then
    warn "Tool stub '$stub_file' already exists — skipping (non-destructive idempotent run)."
    skipped_tools+=("$tool_name")
    continue
  fi

  cat > "$stub_file" <<STUB
# Tool: ${tool_name}

**Agent:** ${agent_id}
**Agent-spec:** agent-spec/v1
**Source:** $(basename "$spec_file")

## Purpose

${tool_purpose}

---

## Implementation — TODO (builder fills this section)

<!-- Describe the real implementation of this tool below.
     Replace this comment block with:
       - The tool's API / function signature
       - Parameter types and constraints
       - Return shape (must match agent-spec io.output where applicable)
       - Error handling and failure modes
       - Trust model: if this tool receives untrusted data (e.g. user-supplied content),
         state so explicitly and note how injection is prevented.
-->

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(TODO)* | | | |

### Returns

| Field | Type | Description |
|-------|------|-------------|
| *(TODO)* | | |

### Error handling

*(TODO: describe error cases and how they surface to the agent)*

### Trust note

*(TODO: state the trust level of inputs this tool receives — see purpose note above)*

---

<!-- scaffold-agent.sh emitted this stub from ${tool_name}.tool.md at $(date -u '+%Y-%m-%dT%H:%M:%SZ').
     This file is a BUILDER STUB — fill in the implementation above before use.
     The agent-spec ($(basename "$spec_file")) was NOT modified. -->
STUB

  notice "  Emitted: tools/${tool_name}.tool.md"
  emitted_tools+=("$tool_name")

done < <(jq -c '.tools[]' "$spec_file")

# ---------------------------------------------------------------------------
# Emit prompt skeleton (idempotent + non-destructive — never clobbers a filled-in prompt)
#
# CROWN-JEWEL: This skeleton is STRUCTURE ONLY.
#   - Contains must-items from prompt_contract.must as section headings / checklist items.
#   - Contains TODO placeholders for the builder.
#   - Contains ZERO actual system/agent/rating prompt text.
#   - The agent-spec is NOT modified.
# ---------------------------------------------------------------------------
notice "--- Emitting prompt skeleton ---"

skeleton_file="$prompts_dir/${agent_id}.v${prompt_version}.md"
skeleton_filename="${agent_id}.v${prompt_version}.md"

if [ -f "$skeleton_file" ]; then
  notice "Prompt skeleton '$skeleton_file' already exists — skipping (idempotent non-destructive run)."
  notice "If you need to regenerate, remove the file and re-run scaffold-agent.sh."
  prompt_emitted=false
else

  # Build the must-items checklist dynamically from the spec
  must_checklist="$(jq -r '.prompt_contract.must[] | "- [ ] \(.)"' "$spec_file")"

  # Collect guardrails as a checklist
  guardrails_list="$(jq -r '.guardrails[] | "- \(.)"' "$spec_file")"

  # Collect io.input fields
  io_input_table="$(jq -r '.io.input | to_entries[] | "| `\(.key)` | \(.value) | *(TODO: describe)* |"' "$spec_file")"

  # Collect io.output fields
  io_output_table="$(jq -r '.io.output | to_entries[] | "| `\(.key)` | \(.value) | *(TODO: describe)* |"' "$spec_file")"

  cat > "$skeleton_file" <<SKELETON
# Prompt Skeleton: ${agent_id} v${prompt_version}

<!-- CROWN-JEWEL: This file is a STRUCTURE SKELETON, not prompt text.
     It contains the must-invariants from the agent-spec as section headings
     and TODO placeholders for the builder. It does NOT contain the actual
     system/agent/rating prompt. The prompt text is server-held IP.

     The agent-spec ($(basename "$spec_file")) was NOT modified.

     Generated by: scaffold-agent.sh
     Spec:         agent-spec/v1 · agent: ${agent_id}
     Prompt ver:   ${prompt_version}
     Date:         $(date -u '+%Y-%m-%dT%H:%M:%SZ')
-->

**Agent:** ${agent_id}
**Prompt version:** ${prompt_version}
**Status:** SKELETON — builder must satisfy every must-item below before this prompt is production-ready.

---

## How to use this skeleton

1. This file defines the CONTRACT the prompt must satisfy — it is NOT the prompt itself.
2. Each section below corresponds to a \`must\` invariant from the agent-spec.
3. For each invariant, implement the prompt behaviour that satisfies it (in your server-held prompt file).
4. Tick the checklist items when you have verified the prompt satisfies each invariant.
5. Do NOT embed the actual prompt text in this file — it is server-held IP (crown-jewel invariant).
6. When all items are satisfied, change Status above to ACTIVE and record the eval run-log reference.

---

## Must-invariants checklist

The following invariants are drawn directly from \`prompt_contract.must\` in the agent-spec.
The prompt implementation MUST satisfy every one of these before the agent may be rated.

${must_checklist}

---

## Must-invariant implementation notes

<!-- For each invariant above, add a note here describing HOW the prompt satisfies it.
     This section is optional but strongly recommended for reviewers.
     Do NOT paste prompt text here — describe the mechanism only. -->

$(jq -r '.prompt_contract.must[] | "### Invariant: \(.)\n\n*(TODO: describe the mechanism that satisfies this invariant — no prompt text here)*\n"' "$spec_file")

---

## I/O contract

These fields are drawn from \`io\` in the agent-spec. The prompt must handle these shapes.

### Input

| Field | Type | Notes |
|-------|------|-------|
${io_input_table}

### Output

| Field | Type | Notes |
|-------|------|-------|
${io_output_table}

---

## Guardrails

The following guardrails are drawn from the agent-spec. The prompt must enforce every one of them.

${guardrails_list}

### Guardrail implementation notes

<!-- For each guardrail, describe HOW the prompt enforces it. No prompt text. -->

$(jq -r '.guardrails[] | "- **\(.):** *(TODO: describe enforcement mechanism)*"' "$spec_file")

---

## Eval linkage

When this prompt version is evaluated, the eval run-log ties the score
to this version string: **${prompt_version}**

- Eval-spec reference: *(TODO: path to <agent>.eval-spec.json)*
- Eval run-log:        *(TODO: path or record reference)*
- Gate result:         *(TODO: PASS / CONDITIONAL / FAIL once rated)*

---

## Builder checklist

Before marking this prompt ACTIVE:

- [ ] Every must-invariant above has been implemented and verified in the real prompt.
- [ ] Guardrails have been tested with adversarial inputs.
- [ ] I/O shapes match the agent-spec io contract.
- [ ] An independent eval run-log exists for this prompt version (see Eval linkage above).
- [ ] The actual prompt text has NOT been placed in this file (crown-jewel).
- [ ] The agent-spec ($(basename "$spec_file")) has NOT been modified.

---

<!-- scaffold-agent.sh · SmartForge V2 · Tier-2 agent scaffold · agent-spec/v1 -->
SKELETON

  notice "  Emitted: prompts/${skeleton_filename}"
  prompt_emitted=true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
notice "--- Scaffold complete ---"
notice "Agent-spec input: $spec_file (read-only — NOT modified)"
notice "Output directory: $out_dir"
echo ""
if [ ${#emitted_tools[@]} -gt 0 ]; then
  for t in "${emitted_tools[@]}"; do
    notice "  EMITTED  tools/${t}.tool.md"
  done
fi
if [ ${#skipped_tools[@]} -gt 0 ]; then
  for t in "${skipped_tools[@]}"; do
    notice "  SKIPPED  tools/${t}.tool.md (already exists)"
  done
fi
if [ "$prompt_emitted" = "true" ]; then
  notice "  EMITTED  prompts/${skeleton_filename}"
else
  notice "  SKIPPED  prompts/${skeleton_filename} (already exists)"
fi
echo ""
notice "CROWN-JEWEL: The prompt skeleton is structure only — no prompt text was written."
notice "CROWN-JEWEL: The agent-spec '$spec_file' was NOT modified."
