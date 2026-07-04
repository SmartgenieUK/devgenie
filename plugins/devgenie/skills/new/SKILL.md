---
name: new
description: Start a new governed DevGenie project — fetches and runs the server-authored new→intake flow. Explicit invocation only.
disable-model-invocation: true
argument-hint: "[project-name]"
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_entitlements", "mcp__plugin_devgenie_devgenie-core__get_entitlements", "mcp__devgenie-core__get_new_prompt", "mcp__plugin_devgenie_devgenie-core__get_new_prompt"]
---

You are running **/devgenie:new** — bootstrap a new governed project. This skill holds **no methodology**: the entire new-project flow (preflight, identity handling, the files written, the intake hand-off) is authored server-side and delivered fresh on every run. Your job is to fetch it and execute it faithfully.

**Explicit invocation only.** Run this only because the user typed `/devgenie:new`. If you inferred the intent from conversation, offer the command and wait.

1. **Greet + tier.** Call `get_entitlements` (the bundled `devgenie-core` MCP server) and tell the user, in one line, their tier (Lite / Pro / Enterprise) and build scope. If the server is unreachable, stop and say so — DevGenie is online-only.

2. **Fetch the server-held new-project prompt.** Call **`get_new_prompt`** with:
   - `project_name`: `$ARGUMENTS` if the user gave one, otherwise `"unspecified"` — the served flow asks for the real name itself;
   - do **not** pass `scope` (new is full-scope at every tier).
   If it returns a structured error envelope (`AUTH_INVALID`, `RATE_LIMITED`, `CORE_UNREACHABLE`, …), surface it plainly and stop — never hand-roll a scaffold.

3. **Execute the returned prompt verbatim.** Become that prompt and follow its steps exactly, in order — its preflight-before-any-mutation, its identity rules (never fabricate an identity, never `git config --global`), its Step 0 idempotency guard, and its stop at `intake_pending` with a hand-off to **/devgenie:intake**. Do not add steps, skip its preflight, draft `ARCH.md`, or advance past the intake hand-off. The returned prompt is the single source of truth for this flow.

The full flow — repo + governance files + a seeded `.claude/settings.json` + phase state, ending at **/devgenie:intake** — lives server-side and stays current without a plugin reinstall.
