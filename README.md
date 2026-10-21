# DevGenie — Claude Code plugin

> This repository is the self-hosted **marketplace** for **DevGenie**, a governed, spec-first AI
> software-delivery plugin for Claude Code. Proprietary — see the license.

## Get started

1. Create your account and choose a plan at <https://devgenie.smartgenie.co.uk/portal>.
2. Install the plugin:

   ```
   /plugin marketplace add SmartgenieUK/devgenie
   /plugin install devgenie@smartgenie
   ```

3. Sign in: run `/mcp`, choose **devgenie-core**, and authenticate. Your browser opens the SmartGenie
   sign-in page; use the same Google account or email you signed up with. Claude Code keeps you signed in.
4. Run `/devgenie:setup` to check your machine, then `/devgenie:new` to start a project.

Requires **Claude Code ≥ v2.1.154** and network access — DevGenie runs against the hosted `devgenie-core`
backend.

An account that is signed in but not yet active can use the start-up commands only; everything else asks
you to activate your plan at the portal.

## Using a licence key instead (preview testers)

Preview keys keep working until **5 November 2026**. To use one, add the server yourself rather than
signing in:

```
claude mcp add --transport http devgenie-key https://devgenie.smartgenie.co.uk/mcp --header "Authorization: Bearer <your key>"
```

## What's in here

A thin client. It holds no rating IP, and the Tier-2 build methodology is served, not bundled: the
prompts, templates, the rating gate, entitlements, the audit trail and chargeback run **server-side** in
the `devgenie-core` backend and are served per call, gated by your plan.

```
devgenie/
├─ .claude-plugin/marketplace.json     # lists the devgenie plugin (marketplace id: smartgenie)
└─ plugins/devgenie/
   ├─ .claude-plugin/plugin.json        # plugin manifest
   ├─ .mcp.json                         # the hosted backend, with browser sign-in
   ├─ skills/                           # thin /devgenie:* commands that fetch the served prompts
   ├─ scripts/guard.sh                  # gate checks on your own project files
   └─ templates/                        # bare schemas and project-metrics hooks
```

---
*DevGenie by SmartGenie Ltd. Proprietary — `LicenseRef-SmartGenie-Proprietary`. © 2026 SmartGenie UK.*
