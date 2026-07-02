---
name: new
description: Start a new governed DevGenie project — scaffold the repo skeleton and hand off to /devgenie:foundation. Explicit invocation only.
disable-model-invocation: true
argument-hint: "[project-name]"
allowed-tools: [Bash, Read, Write, "mcp__devgenie-core__get_entitlements", "mcp__plugin_devgenie_devgenie-core__get_entitlements"]
---

You are running **/devgenie:new** — bootstrap a new governed project. Follow these steps exactly; do not invent methodology (it lives server-side).

1. **Greet + tier.** Call the `get_entitlements` tool (the bundled `devgenie-core` MCP server) and tell the user, in one line, their tier (Lite / Pro / Enterprise) and build scope. If the server is unreachable, stop and say so — DevGenie is online-only.
2. **Gather three inputs** conversationally, nothing more:
   - project name (use `$ARGUMENTS` if provided),
   - regulated? (y/n),
   - create a GitHub remote? (y/n).
3. **Scaffold the repo.** Run this, show its output verbatim, and stop on any non-zero exit:
   ```
   bash "${CLAUDE_PLUGIN_ROOT}/skills/new/scaffold-repo.sh" --name "<project>" [--regulated] [--no-remote]
   ```
4. **Verify.** Read back `<project>/.devgenie/state.json` and confirm `phase` is `foundation_pending`. Show `git -C "<project>" log --oneline -1`.
5. **Hand off.** Tell the user to add their brief to `docs/inputs/`, then run **/devgenie:foundation**.

Hard rules: never write `ARCH.md` here; never advance the phase past `foundation_pending`; you only scaffold structure.
