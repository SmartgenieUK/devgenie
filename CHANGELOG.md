# Changelog — the DevGenie plugin

## 0.3.7

Pairs with the DevGenie server at contract v1.29. **The server is updated first, and this plugin is released straight
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
  and not edited; it does not prove your inputs are true, it does not tie the result to one project, and someone who
  edits the plugin can switch it off. It is a guard rail for your own build, not a certificate for a third party.
