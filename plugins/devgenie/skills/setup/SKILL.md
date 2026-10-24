---
name: setup
description: "Idempotent first-run preflight for DevGenie (/devgenie:setup). Checks the Claude Code version, reports each dependency honestly (never 'missing' for something installed-but-stale), detects a stale session that needs a restart, then confirms you are signed in and your account resolves against the server. Safe to re-run; holds no methodology and never handles a credential itself."
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

- **`version-too-old` / `version-unknown`** — stop. Tell the user to update Claude Code to **≥ v2.1.154** and re-run `/devgenie:setup`. Never assume the version is fine.
- **`missing-deps`** — stop. The named tool(s) are genuinely absent; the user installs them, then re-runs `/devgenie:setup`.
- **`needs-restart`** — stop. The tool is installed but not visible to **this** session (a stale PATH). Tell the user to **restart Claude Code** and re-run — **do not** tell them to reinstall.
- **`ready`** — the environment is good; continue to Step 2.

## Step 2 — Confirm you are signed in

Only on `ready`. Call the **`get_entitlements`** MCP tool once (it takes no credential argument — identity is resolved server-side from the sign-in).

- **On success** — report the resolved plan plainly: "DevGenie is ready — you're on the **<tier>** plan." If the result says the account is not active yet, say so and point to the portal (below). Onboarding is done.
- **On `AUTH_INVALID`** — you are not signed in. Deliver this owned message; do **not** echo the raw error envelope:

  > Sign in to DevGenie: run `/mcp`, choose **devgenie-core**, and authenticate in your browser with the account you signed up with. No account yet? Create one at https://devgenie.smartgenie.co.uk/portal. Then re-run `/devgenie:setup`.

- **On `UPGRADE_REQUIRED`** — you are signed in but your plan is not active yet. Deliver this owned message:

  > Your account is not active yet. Activate your plan at https://devgenie.smartgenie.co.uk/portal, then re-run `/devgenie:setup`.

- **On `CORE_UNREACHABLE`** — the server is unreachable; surface it plainly and suggest checking the connection. Do not invent a degraded local mode.

## Hard rules

- **Never handle the sign-in token.** Do not read it, store it, print it, pass it as a tool argument, or write it to any file or the transcript. Sign-in happens **only** in Claude Code's own browser flow (run `/mcp`); Claude Code keeps the token and sends it to the server itself. `setup.mjs` makes no server call and holds no credential — keep it that way.
- **Never fabricate a pass.** An unknown Claude Code version is `version-unknown`, not "probably fine." A stale dependency is `needs-restart`, never `missing`.
- **Never advance the build.** `setup` readies the environment; it does not run `/devgenie:new` or any build step.
