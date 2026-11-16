---
name: feedback
description: Sends a developer's own feedback to DevGenie after confirmation. Use when a developer explicitly invokes /devgenie:feedback to send a note or report a bug.
disable-model-invocation: true
allowed-tools: ["mcp__devgenie-core__send_feedback", "mcp__plugin_devgenie_devgenie-core__send_feedback"]
---

# /devgenie:feedback

**Explicit invocation only.** Run only when the developer types `/devgenie:feedback`.

Ask for the developer's own note and whether it is a bug, unless already supplied. Keep their words verbatim. Set `kind` to `bug` or `feedback` accordingly. The note must be at most 4,000 UTF-16 code units; ask for a shorter note if needed. Never truncate it silently.

Use only context already known in this session: `plugin_version`, `flow_version`, `methodology_version`, `last_skill`, `last_outcome_code` and `os_family`. Use the literal `unknown` for missing values; never guess. The first five values must each be strings of 1-64 UTF-16 code units. OS family must be `windows`, `macos`, `linux`, `other` or `unknown`. Do not collect or attach files, transcript or environment dumps, or diagnostics.

Show the exact JSON payload in a JSON block: an object containing only `note`, `kind` and `context`, with all six context fields. Include no account id or identity. Explain separately that the account comes from the developer's sign-in.

Ask once: `Send this feedback to DevGenie?` Then wait for an explicit confirmation. Refusal or silence means do not send anything. Only after confirmation, call `send_feedback` once with exactly the displayed payload. If the developer changes it, show the replacement payload and obtain confirmation again before sending it.

Report the returned `feedback_id` on success. On error, show the closed `error.message` plainly and stop. Do not retry automatically.
