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

## How intake works

`/devgenie:intake` runs before `/devgenie:foundation`. It checks that what you have put in `docs/inputs/` (your
brief, discovery notes and so on) carries the facts each part of the design needs, so foundation designs from your
facts rather than guesses. Intake designs nothing itself.

**What happens when you run it.** Claude Code reads `docs/inputs/` and rates each thing intake checks as present,
partial or absent, citing the file and line it relies on. It asks you the solution questions your inputs leave open,
each with a short explanation. DevGenie then decides the verdict and signs the result.

**The four verdicts.**

| Verdict | What it means | What you do next |
|---|---|---|
| PASS | Everything intake rated is present, and the key solution questions are answered. | Run `/devgenie:foundation`. |
| CONDITIONAL | Something the build does not depend on is still open; it is recorded for foundation. | Run `/devgenie:foundation`. |
| HOLD | Something the build depends on is only partly covered, or a key solution question is unanswered. | Answer the one question intake asks; it checks again. |
| FAIL | Something the build depends on is missing, or you declined to decide it. | Make the decision intake asks for, or add what is missing to `docs/inputs/`, and run `/devgenie:intake` again. |

**Answering questions.** Intake asks one question at a time, in terms taken from your own inputs, saying what it
means, why it matters and what a good answer contains. Each answer is saved as a file in
`docs/inputs/intake-answers/`, so it becomes part of your inputs, and intake checks again. There is no limit on the
number of rounds.

**The signed result.** The result is saved as `.devgenie/intake.json`, signed by DevGenie. `/devgenie:foundation`,
`/devgenie:agent-foundation`, `/devgenie:gate` and `/devgenie:scaffold` each check that signature, and go ahead only
on PASS or CONDITIONAL. A change to the verdict, or to anything else DevGenie signed, is detected and blocks: run
`/devgenie:intake` again rather than editing the file. The signature shows that DevGenie made the decision; it does
not make your inputs true.

**Every kind of project.** Intake asks whether your project is new, an existing system, a replacement or a salvage.
For now every kind is checked with the new-project rule, and the kind you confirmed is recorded in the result.

**What stays on your machine.** Intake never sends file contents or quotes from your files. It sends the kind of
project, the build depth, a few yes-or-no facts about the project, each rating with the file name and line it cites,
and short answers to the solution questions.

**Updating from plugin 0.3.6.** Update the plugin (`/plugin marketplace update smartgenie`, then
`/plugin install devgenie@smartgenie`), restart Claude Code and run `/devgenie:intake` once. An intake result recorded
before 0.3.7 is not signed, so foundation, agent-foundation, the gate and scaffold ask for that one re-run the next
time a project reaches them. A project that does not run any of these again is not affected.

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
