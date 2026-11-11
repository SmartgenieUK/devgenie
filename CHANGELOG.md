# Changelog — the DevGenie plugin

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
