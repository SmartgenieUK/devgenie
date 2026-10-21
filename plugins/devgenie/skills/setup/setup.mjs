#!/usr/bin/env node
// client/skills/setup/setup.mjs — the /devgenie:setup preflight helper (CR-170).
//
// Pure environment mechanics; holds NO methodology and NO key. It never reads, stores, or transmits the
// licence key and never makes a server call — the key is entered only through the plugin config UI and
// the connectivity probe is the SKILL.md's job (only the Claude Code host holds the MCP connection).
//
// Two halves:
//   • decide(probe)  — a PURE function over already-gathered probe results. This is what the gate drives.
//   • the CLI        — gathers the real probes (Claude Code version, dependency visibility) and prints
//                      decide()'s verdict. Platform-detecting via process.platform; NO OS/provider switches.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

export const MIN_CLAUDE_VERSION = "2.1.154"; // the version that added userConfig header interpolation
export const DEPS = ["jq", "openssl", "base64"];

// Compare dotted numeric versions. Returns <0, 0, >0 like a comparator. Non-numeric tails are ignored.
export function cmpVersion(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// The PURE decision. `probe` = { claudeVersion: string|null, deps: {name: "ok"|"needs-restart"|"missing"} }.
// Ordered so the customer learns the earliest blocker first, and every outcome is a NAMED state — never a
// raw error and never a fabricated pass.
export function decide(probe) {
  const { claudeVersion, deps = {} } = probe;

  // 1. Claude Code version floor. Unknown is reported honestly, never assumed OK.
  if (claudeVersion == null)
    return { state: "version-unknown", ok: false,
      message: `Could not detect the Claude Code version. DevGenie needs >= v${MIN_CLAUDE_VERSION}. Check with \`claude --version\`.` };
  if (cmpVersion(claudeVersion, MIN_CLAUDE_VERSION) < 0)
    return { state: "version-too-old", ok: false,
      message: `Claude Code ${claudeVersion} is too old — DevGenie needs >= v${MIN_CLAUDE_VERSION} (the version that passes your licence key to the server). Update Claude Code, then re-run /devgenie:setup.` };

  // 2. Dependencies. A genuinely-absent dep must be installed; a present-but-stale one only needs a restart.
  const missing = DEPS.filter((d) => deps[d] === "missing");
  if (missing.length)
    return { state: "missing-deps", ok: false, missing,
      message: `Missing required tool(s): ${missing.join(", ")}. Install them, then re-run /devgenie:setup.` };

  const stale = DEPS.filter((d) => deps[d] === "needs-restart");
  if (stale.length)
    return { state: "needs-restart", ok: false, stale,
      message: `${stale.join(", ")} is installed but not visible to this session yet. Restart Claude Code, then re-run /devgenie:setup — do NOT reinstall.` };

  // 3. Environment is ready. Key capture + the connectivity probe are the SKILL.md's steps; this helper
  //    never handles the key.
  return { state: "ready", ok: true,
    message: "Environment ready. Next: make sure your licence key is set (/plugin configure devgenie@smartgenie), then run any /devgenie:* command." };
}

// ── real probes (CLI side; decide() stays pure and testable) ─────────────────────────────────────────

export function probeClaudeVersion(run = spawnSync) {
  const r = run("claude", ["--version"], { encoding: "utf8" });
  const out = `${r?.stdout || ""}`.trim();
  const m = /(\d+\.\d+\.\d+)/.exec(out);
  return m ? m[1] : null;
}

// A dependency is: on this process's PATH (ok); else present in a platform install dir or on the machine
// PATH but not this process's (needs-restart — the stale-session case); else missing. Node mirror of the
// guard's three-state check, extended on win32 to read the machine/user PATH the running shell can't see.
export function probeDep(name, env = process.env, platform = process.platform) {
  const onPath = (env.PATH || "").split(delimiter).some((d) => d && (existsSync(join(d, name)) || existsSync(join(d, `${name}.exe`))));
  if (onPath) return "ok";

  const dirs = [];
  if (platform === "win32") {
    dirs.push("C:/ProgramData/chocolatey/bin", "C:/Program Files/Git/usr/bin", "C:/Program Files/Git/mingw64/bin");
    for (const scope of ["Machine", "User"]) {
      const ps = spawnSync("powershell", ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('Path','${scope}')`], { encoding: "utf8" });
      for (const d of `${ps?.stdout || ""}`.trim().split(";")) if (d) dirs.push(d);
    }
  } else {
    dirs.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin");
  }
  const findable = dirs.some((d) => d && (existsSync(join(d, name)) || existsSync(join(d, `${name}.exe`))));
  return findable ? "needs-restart" : "missing";
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
// Run directly (node setup.mjs) to gather the real probes and print the verdict.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("setup.mjs")) {
  const deps = Object.fromEntries(DEPS.map((d) => [d, probeDep(d)]));
  const verdict = decide({ claudeVersion: probeClaudeVersion(), deps });
  console.log(verdict.message);
  process.exit(verdict.ok ? 0 : 1);
}
