---
name: setup
description: "Idempotent first-run preflight for DevGenie (/devgenie:setup). Checks the Claude Code version, reports each dependency honestly (never 'missing' for something installed-but-stale), detects a stale session that needs a restart, then confirms your licence key resolves against the server. Safe to re-run; holds no methodology and never handles the key itself."
allowed-tools: [Bash]
---

# /devgenie:setup — get a new machine ready for DevGenie

**Explicit invocation only.** Run this when the user typed `/devgenie:setup`. It is **idempotent** — safe to re-run any number of times; every check re-runs and the environment converges. It is **platform-detecting** (Windows / macOS / Linux) with **no OS, provider, or device switches**: DevGenie runs wherever Claude Code runs, and only there.

This command holds **no methodology**. Its whole job is to turn "it didn't work" into a named, actionable state before you hit a wall four commands deep.

## Step 1 — Run the environment preflight

```
node "${CLAUDE_PLUGIN_ROOT}/skills/setup/setup.mjs"
```

Show its output verbatim, then act on the named state — do **not** paper over it:

- **`version-too-old` / `version-unknown`** — stop. Tell the user to update Claude Code to **≥ v2.1.154** (the version that passes the licence key to the server) and re-run `/devgenie:setup`. Never assume the version is fine.
- **`missing-deps`** — stop. The named tool(s) are genuinely absent; the user installs them, then re-runs `/devgenie:setup`.
- **`needs-restart`** — stop. The tool is installed but not visible to **this** session (a stale PATH). Tell the user to **restart Claude Code** and re-run — **do not** tell them to reinstall.
- **`ready`** — the environment is good; continue to Step 2.

## Step 2 — Confirm the licence key resolves

Only on `ready`. Call the **`get_entitlements`** MCP tool once (it takes no key argument — identity is resolved server-side from the licence-key header).

- **On success** — report the resolved tier plainly: "DevGenie is ready — you're on the **<tier>** tier." Onboarding is done.
- **On `AUTH_INVALID`** — the key is missing or not recognised (during private preview **every tier needs a key**). Deliver this owned message; do **not** echo the raw error envelope:

  > You need a DevGenie licence key. Set it with `/plugin configure devgenie@smartgenie` → **DevGenie license key**. Don't have one yet? Request a preview key from **support@smartgenie.co.uk**. Then re-run `/devgenie:setup`.

- **On `CORE_UNREACHABLE`** — the server is unreachable; surface it plainly and suggest checking the connection. Do not invent a degraded local mode.

## Hard rules

- **Never handle the key.** Do not read it, store it, print it, pass it as a tool argument, or write it to any file or the transcript. The key is entered **only** through the plugin config UI (`/plugin configure`), stored in the OS keychain, and reaches the server as a transport header. `setup.mjs` makes no server call and holds no key — keep it that way.
- **Never fabricate a pass.** An unknown Claude Code version is `version-unknown`, not "probably fine." A stale dependency is `needs-restart`, never `missing`.
- **Never advance the build.** `setup` readies the environment; it does not run `/devgenie:new` or any build step.
