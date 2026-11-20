# Changelog — the DevGenie plugin

## 0.3.21

- **New: `/devgenie:evidence`, the evidence gate (Lite v1 starter kit).** Switch it on in a project and Claude must cite the file and lines behind what it writes about your project; a write without that evidence is refused and noted in a local report. It is opt-in, one project at a time, and needs Node.js 18 or later and a DevGenie sign-in. Run the skill again to switch it off.
- **Changed: `/devgenie:compactorclear` records each compact or clear in one shared event log,** `.devgenie/events.jsonl` in the project, which other DevGenie commands will use too. An existing `.devgenie/compactor.jsonl` is left as it is.

## 0.3.20

- **Fixed: signing in on a Mac.** The sign-in could not be saved ("Could not reach the saved sign-in store"). It is now kept as a file only you can read, under `~/.devgenie/auth/`, as on Linux. Run the sign-in command again.
- **Fixed: "Continue with Google" from the sign-in link.** Google refused it with "redirect_uri_mismatch"; the link now uses the same sign-in page as the website.
- **Changed: the code prompt says the code will not show as you paste it,** and to press Enter.

## 0.3.19

- **New: `/devgenie:uninstall`, remove DevGenie's local setup (Lite v1 starter kit).** It cleans the current project by default, or every project DevGenie set up with `-all`. It first shows everything it will remove and everything it will keep, and changes nothing until you confirm. Starter files you have edited are kept and reported. Your account stays; with `-all` it reminds you to sign out first.
- **Changed: setting up a DevGenie kit in a project now notes that project in a local list on your machine,** so `/devgenie:uninstall -all` can find it later. The list stays on your machine.
- **Fixed: two test gates finishing at the same moment no longer fail** when the operating system briefly locks the receipt file; the gate retries the save instead.
- **Changed: `/devgenie:evidence` (being rolled out) now links to its documentation page,** https://www.smartgenie.co.uk/devgenie/docs/evidence, so you can read how it will work.

## 0.3.18

- **New: `/devgenie:update`, update DevGenie in one command (Lite v1 starter kit).** It updates the DevGenie plugin through Claude Code's own plugin commands, shows the release notes for each version it moved through, then asks you to restart Claude Code. If a step needs you to confirm something, it stops and shows you the command to run instead of confirming on your behalf.

## 0.3.17

- **New: `/devgenie:feedback`, send feedback to the DevGenie team (Lite v1 starter kit).** It shows exactly what it will send, which is your note plus six short facts such as the plugin version and your OS family, and asks for one confirmation first. Your account comes from your sign-in. Feedback has its own daily allowance: 20 a day on Lite and unlimited on paid plans.
- **New: `/devgenie:cac`, change admission (Lite v1 starter kit).** An optional guard that stops a commit Claude makes through its Bash tool if it changes code without citing an open or accepted change record from `/devgenie:raise`. Commits that change only documentation pass. It records refusals in a private file on your machine, and you can switch it off or undo it at any time. Commits from your terminal or IDE are outside its scope.
- **New: `/devgenie:evidence` (being rolled out).** Running it shows a short message saying it is being rolled out. It calls no service and writes nothing.

The instructions for feedback and cac are fetched from the DevGenie service when you run them.

## 0.3.16

- **New: `/devgenie:compactorclear`, compact-or-clear advice (Lite v1 starter kit).** Ask whether to `/compact` or `/clear` your session; you get one recommendation and, for compact, a focus line to paste. It offers to save lasting notes in your project first, never runs either command itself, and logs the advice word locally.
- **New: `/devgenie:close`, wind down a work session (Lite v1 starter kit).** Shows the active task and uncommitted work, asks whether the work is finished and what comes next, and writes one local close row only after you say yes. It never commits or pushes.
- **New: `/devgenie:sessions`, local session records (Lite v1 starter kit).** Installs a status line showing the model and how full the context is, and a local log of each session's steps and elapsed time, with `report`, `off`, `on` and `undo`. All records stay on your machine.

Each one's instructions are fetched from the DevGenie service when you run it.

## 0.3.15

- **New: `/devgenie:raise`, plain change and bug records (Lite v1 starter kit).** Raise a change request or log a bug as a record file in your project; the records kit is fetched from the DevGenie service when you run it.
- **New: `/devgenie:coarch` and `/devgenie:executor`, two-window working (Lite v1 starter kit).** Run one Claude Code window as the architect, which plans and writes briefs, and another as the builder, which builds one issued brief at a time. Each role's instructions are fetched from the DevGenie service when you run it.

## 0.3.14

- **New: `/devgenie:test`, the test-first practice (Lite v1 starter kit).** One command runs your project's tests as a gate and keeps a local report of test runs; an opt-in commit hook can run it before each commit. Its method is fetched from the DevGenie service when you run it (any signed-in account, Lite included); the plugin carries only the front door and its scripts.
- **`/devgenie:task` install tells you when git will not share it.** If your project ignores `.claude/` (or any file the install writes), install says so in one line and asks each developer to run it once in their own clone. It also recognises an existing token-ledger hook that names its script in `args`, so a second one is not added.

## 0.3.13

- **New: `/devgenie:task`, the task pointer practice (Lite v1 starter kit).** Keeps your project's active task in one place, warns at session start when the pointer looks stale, files each session's token usage under the right task, and gives a per-task report. The practice's method is fetched from the DevGenie service when you run it (any signed-in account, Lite included); the plugin carries only the front door and its scripts. Turn it off by removing the block it adds.

## 0.3.12

- **Lite, the free plan.** `/devgenie:setup` now names your plan as the server states it, including Lite, and gives the next step: run `/devgenie:new` in your project folder.
- **Clearer account messages.** When you are signed in but have no active account, or DevGenie could not check your account, `/devgenie:setup` shows the server's own plain message saying what to do.
- **The optional email setting is titled "Your email"** and explained in plain words: any address, used only to label your AI token-usage records.
- **README: the Lite path.** Get started now begins with a free Lite account (any email address, no card; the account page asks for an optional company name and LinkedIn URL), then install, `/devgenie:setup`, the sign-in command run in a terminal of your own, and `/devgenie:new`. Pro is named as the upgrade.
- **README: the preview-key section is removed.** The preview keys ended on 5 November 2026; customers sign in with the sign-in command. The README no longer documents the key route.

## 0.3.11

- **The DevGenie logo at session start.** When you start or resume a Claude Code session and are signed in to
  DevGenie, the DevGenie logo shows once. It never shows when you are not signed in, and never after `/clear`.
- **Clearer sign-in advice.** `/devgenie:setup` now says to run the sign-in command in a separate terminal or SSH
  session, never through Claude or with a `!` prefix: the command reads from a real keyboard and refuses anything else.

## 0.3.10

- **Fix: sign-in now saves after you answer y.** In 0.3.9 the "Sign in as ...? [y/N]" question read your answer too
  late and treated it as no, so a real terminal always printed "Not saved.". Update, then run the sign-in command again.

## 0.3.9

Pairs with the DevGenie server at contract v1.36. **Sign in again once after updating.**

- **Sign in from any device.** Run the sign-in command `/devgenie:setup` gives you, in a terminal of your own (a
  second SSH session works). It prints a link: open it on any device, a phone included, sign in, copy the code the
  page shows and paste it into that terminal. It works on a remote machine with no browser.
- **Run it once after updating.** This version stops using Claude Code's own browser sign-in for DevGenie, so
  DevGenie shows as failed to connect until you run the sign-in command once. `/devgenie:setup` gives you the
  command with its full path.
- **Signing out.** Run the same command with `--sign-out`. It removes the sign-in from this machine only; an open
  Claude Code session can keep working for up to an hour, so restart open sessions.
- **A damaged sign-in is reported, not trusted.** If the saved sign-in cannot be used, `/devgenie:setup` and
  `--status` say you are not signed in; run the sign-in command again.
- **Where the sign-in is kept.** macOS: your login keychain. Windows: encrypted for your Windows account. Linux: a
  file only you can read, under `~/.devgenie/auth/`.

## 0.3.8

Pairs with the DevGenie server at contract v1.31. **Update this plugin first; the server's change goes live after it.**
This version checks both the intake results today's server signs and the new ones. Plugin 0.3.7 cannot check the new
ones, so once the server is updated, a new intake result is refused on 0.3.7 at foundation, agent-foundation, the gate
and scaffold ("the intake result's receipt does not verify") until you update; after updating, run the command again,
with no intake re-run.

- **Intake asks about the UI.** The solution card asks three more questions: does the solution have a user interface
  and on which devices, is there a brand or design system to follow, and what accessibility level is wanted (for
  example WCAG 2.2 AA). "Not decided yet" is an answer: foundation proposes a default for you to confirm.
- **Salvage projects get their own rule and a triage.** For a salvage project, Claude Code also reads the existing
  code (security first, then what works today, then what can be kept) and records keep, fix or rebuild for each part,
  each citing the code by file and line. DevGenie refuses a keep call for any part the triage marks with a security
  finding, but it cannot check that the triage found every security problem. DevGenie checks the triage's shape and signs it with the verdict; the triage never changes the verdict, and DevGenie does not scan your
  code. Existing systems and replacements are still checked with the new-project rule for now.
- **Agent-scaffold checks the intake result.** `/devgenie:agent-scaffold` now verifies the signed intake result
  before it checks the Tier-2 gate, as `/devgenie:scaffold` does. A missing intake result, one recorded before
  plugin 0.3.7 (unsigned), or one that fails its signature check (something DevGenie signed was changed) blocks with
  a message to run `/devgenie:intake` once.
- **Your signed intake result still works.** A result signed while you used 0.3.7 still unlocks foundation,
  agent-foundation, the gate, scaffold and agent-scaffold; nothing needs re-running for it.

## 0.3.7

Pairs with the DevGenie server at contract v1.30. **The server is updated first, and this plugin is released straight
after.** Until you update, plugin 0.3.6 keeps working with an intake result that passed; a CONDITIONAL result, or a
fresh `/devgenie:intake`, needs this version: update the plugin, restart Claude Code and run `/devgenie:intake` once.

- **Intake is decided by DevGenie.** `/devgenie:intake` rates your inputs with file-and-line citations and asks every
  open question with a short explanation; the server tool `s_intake` decides PASS, CONDITIONAL, HOLD or FAIL and signs
  the result. On HOLD you answer one question at a time until the verdict is reached.
- **Every kind of project.** New, existing, replacing and salvage projects all get a signed intake result. In this
  release DevGenie decides each with the new-project rule and records the kind you confirmed; rules of their own for
  existing, replacing and salvage projects come in a later release.
- **Only a signed intake result unlocks.** `/devgenie:foundation` (before drafting), the rating gate's foundation
  check and `/devgenie:scaffold` each verify the intake result's signature with the key bundled in this plugin, and
  unlock only on PASS or CONDITIONAL. An edited result, or one without a signed receipt, blocks with a message to
  re-run `/devgenie:intake`.
- **Tier-2 agent foundation too.** `/devgenie:agent-foundation` runs the same check before drafting: a signed PASS
  or CONDITIONAL proceeds; an intake result from before this release, an edited one, or none blocks with a message
  to re-run `/devgenie:intake`.
- **What this means for an existing project.** A project that returns to foundation, or is past its gate but not yet
  scaffolded, or moves up to a production scaffold, and holds an intake result from before this release (or none),
  runs `/devgenie:intake` once. Projects already scaffolded are not affected.
- **What the check is, and is not.** The check runs on your machine. It confirms the result was issued by DevGenie
  and that nothing DevGenie signed was changed; it does not prove your inputs are true, it does not tie the result to one project, and someone who
  edits the plugin can switch it off. It is a guard rail for your own build, not a certificate for a third party.
- **How intake works.** The README has a new section: what intake checks, the four verdicts, answering its
  questions, the signed result, and updating from 0.3.6.
