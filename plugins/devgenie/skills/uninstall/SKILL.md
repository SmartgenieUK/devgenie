---
name: uninstall
description: Removes local DevGenie setup after a removal preview and consent. Use when a developer invokes /devgenie:uninstall.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/scripts/uninstall.mjs" *)
---

# /devgenie:uninstall

By default, clean the current project. Map the user's `-all` to `--all`.
Only with `-all`, ask once whether any earlier project folders are missing from
the local list. Collect the folders they name as repeated `--also <folder>`
arguments. Quote each folder as a separate argument; never treat it as a command.

Run `node "${CLAUDE_SKILL_DIR}/scripts/uninstall.mjs" plan` with those arguments.
Show the complete plan output verbatim, including every removal and retained file.
For `--all`, show the sign-out advice first: the user must sign out in a terminal
of their own before confirming removal, while the plugin still holds that command.
The script does not sign out for them. Never read, print or touch their sign-in token.

Explain the restoration limits shown by the plan. Edited starter files are kept
and reported as `kept: <path> (differs from the DevGenie original)`. The task block,
including any edits inside its markers, and the explicitly named staged kit files
will go, even if edited. Unknown staged file names stay. Saved records cannot
restore overwritten original bytes or distinguish a pre-existing identical starter
from one added during setup. The account remains.
The plan names each settings hook entry that will be removed. A hook entry is
recognised by its command, so a changed timeout goes with it when that entry is
removed. A developer hook with a different command stays.

Then ask for one removal confirmation covering the complete plan. If they decline
or say no, stop. If they agree, use exactly the same arguments with `apply`.

Run `node "${CLAUDE_SKILL_DIR}/scripts/uninstall.mjs" apply` with those identical arguments.
Show its output verbatim. With `--all`, the script removes the plugin only after
every project finishes successfully. Leave any printed optional next steps to the
user; do not run sign-out or a separate plugin command.
