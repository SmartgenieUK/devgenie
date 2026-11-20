---
name: evidence
description: "Switches the DevGenie evidence gate on or off for the current project: fetches the gate from the DevGenie server, installs it as local hooks that make Claude cite the file and lines behind what it writes about the project, and logs each refused write to a local report. Use when the developer runs /devgenie:evidence or asks to turn the evidence gate on or off."
allowed-tools: [Bash, Write, "mcp__devgenie-core__get_kit_files", "mcp__plugin_devgenie_devgenie-core__get_kit_files"]
---

# /devgenie:evidence: the evidence gate

Key rules:

- **Opt-in, one project at a time.** Nothing changes until the developer runs this skill in that project. Run the
  scripts from the project root.
- **The default is to switch the gate on.** Switch it off only when the developer asks for that.
- **Requires Node.js 18 or later** on the PATH, and a DevGenie sign-in to fetch the gate.
- Show each script's output exactly as printed. Never edit `.claude/settings.json` by hand for this, and never retype
  a body the server sent.

## Switch it on

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/evidence/scripts/install.mjs" --check
   ```

   If it exits with an error, show the message and stop: it says what to fix, and nothing was changed.
2. Call the `get_kit_files` tool of the bundled DevGenie server with `{ "practice": "evidence" }`. If it returns
   an error, show its message as written and stop.
3. Save the result exactly as returned, as one JSON object `{ "instructions": ..., "files": [...] }`, to
   `.devgenie/kit/evidence.json` with the Write tool. That path only: the check in step 1 covered it.
4. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/evidence/scripts/install.mjs"
   ```

   If it exits with an error, show the message and stop: it says what to fix, and nothing was changed.
5. Follow the result's `instructions` exactly, in order.

## Switch it off

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/skills/evidence/scripts/install.mjs" --remove
```

It removes the three hook entries and the files the gate installed. Other settings and hooks are left as they were,
and the refusals report (`.devgenie/evidence-refusals.jsonl`) is kept. Tell the developer to restart Claude Code.
