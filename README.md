# DevGenie — Claude Code plugin (private preview)

> **Private preview.** This repository is the self-hosted **marketplace** for **DevGenie**, a governed,
> spec-first AI software-delivery plugin for Claude Code. It is **private** during friends-and-family
> testing; access is limited to invited testers. Proprietary — see the license.

## Install (invited testers)

```
/plugin marketplace add SmartgenieUK/devgenie
/plugin install devgenie@smartgenie
```

Requires **Claude Code ≥ v2.1.154** (plugin header interpolation) and network access — DevGenie runs
against the hosted `devgenie-core` backend from day one (there is no offline path outside Enterprise).

## Tiers (selected by your license key)

- **Lite** — free, online. Leave the license key blank. Full feature capture + a real, gated MVP build.
- **Pro / Enterprise** — enter your key to unlock the production-scope build, the independent **signed**
  rating gate, premium templates, an audit-grade decision trail, and AI-spend chargeback.

Get a key: **sachin@smartgenie.co.uk** · <https://smartgenie.co.uk/devgenie>

## What's in here

This repo holds **nothing of value on its own** — it is a thin client. All methodology (prompts,
templates, the rating gate, entitlements, audit trail, chargeback) runs **server-side** in the licensed
`devgenie-core` backend and is served per call, gated by your entitlement.

```
devgenie/
├─ .claude-plugin/marketplace.json     # lists the devgenie plugin (marketplace id: smartgenie)
└─ plugins/devgenie/
   └─ .claude-plugin/plugin.json        # thin-client manifest (wired to the hosted backend)
   # skills/ (thin /devgenie:* orchestrators) — added after the IP-boundary build
```

---
*DevGenie by SmartGenie Ltd. Proprietary — `LicenseRef-SmartGenie-Proprietary`. © 2026 SmartGenie UK.*
