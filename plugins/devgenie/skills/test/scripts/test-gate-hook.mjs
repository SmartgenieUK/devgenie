#!/usr/bin/env node
// test-gate-hook.mjs - the commit hook. Installed by the /devgenie:test skill as .devgenie/test-gate-hook.mjs and wired into
// the project's .claude/settings.json as a PreToolUse hook on the Bash tool.
//
// When Claude is about to run a git commit, this runs the project's test gate (.devgenie/test-gate.mjs) and blocks the commit,
// with a plain reason on stderr, when the gate is red. Any other command passes straight through. It governs git commits made
// through Claude Code's Bash tool in this project only; it does not see a commit made in a terminal or an IDE.
//
// It fails open on its own problems (bad input, no gate script, a gate that is not set up) and closed on a red or silent gate.
// Off switches: the environment variable DEVGENIE_TEST_GATE=off, or "enforce": false in .devgenie/test-gate.json.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const WIN = process.platform === "win32";
const MAX_SECONDS = 540; // always below the 600 seconds the settings entry gives Claude Code, which lets a call proceed when its own timeout fires
const TAIL_BYTES = 4096;

/** The seconds the hook waits for the gate: an integer from 1 to 540 as configured, otherwise 540. */
export function deadlineSeconds(cfg) {
  const v = cfg?.hook_timeout_seconds;
  return Number.isInteger(v) && v >= 1 && v <= MAX_SECONDS ? v : MAX_SECONDS;
}

const COMMIT = /(^|[\s;&|(])git(\s+(-[cC]\s+("[^"]*"|'[^']*'|\S+)|-\S+))*\s+commit(?![\w-])/;
/** True when a shell command line contains a git commit. */
export function isCommit(command) {
  return typeof command === "string" && COMMIT.test(command);
}

const note = (m) => console.error(`DevGenie test gate hook: ${m}`);

function readStdin(ms, max) {
  return new Promise((resolve) => {
    let buf = "";
    const t = setTimeout(() => resolve(buf), ms);
    const done = () => { clearTimeout(t); resolve(buf); };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { buf += d; if (buf.length > max) done(); });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

function killTree(child) {
  try {
    if (WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

const OFF = "To switch this off: set DEVGENIE_TEST_GATE=off for the session, or put \"enforce\": false in .devgenie/test-gate.json, or run install.mjs --undo.";

function block(headline, tailText) {
  console.error(`DevGenie test gate: this git commit was blocked because ${headline}.`);
  if (tailText) console.error(`Last output of the gate:\n${tailText}`);
  console.error(`Fix the failing test (not the hook), then commit again. ${OFF}`);
  process.exit(2);
}

async function main() {
  if (process.env.DEVGENIE_TEST_GATE === "off") process.exit(0);
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(here, "test-gate.json"), "utf8")) ?? {}; } catch { /* no config: the gate reports it */ }
  if (cfg.enforce === false) process.exit(0);
  let command;
  try { command = JSON.parse(await readStdin(5000, 1024 * 1024))?.tool_input?.command; } catch { note("could not read the tool call, so it was let through"); process.exit(0); }
  if (!isCommit(command)) process.exit(0);
  const gate = join(here, "test-gate.mjs");
  if (!existsSync(gate)) { note("the test gate script is missing, so the commit was let through"); process.exit(0); }
  const resultFile = join(here, `test-gate-result-${process.pid}-${Date.now()}.json`);
  const cleanup = () => { try { rmSync(resultFile, { force: true }); } catch { /* best effort */ } };
  const child = spawn(process.execPath, [gate], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: !WIN, env: { ...process.env, DEVGENIE_TEST_GATE_RESULT_FILE: resultFile } });
  let tail = Buffer.alloc(0);
  const keep = (c) => { tail = Buffer.concat([tail, c]); if (tail.length > TAIL_BYTES) tail = tail.subarray(tail.length - TAIL_BYTES); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const seconds = deadlineSeconds(cfg);
  const closed = new Promise((resolve) => child.on("close", () => resolve("closed")));
  child.on("error", () => { /* handled below: no result file */ });
  const outcome = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve("deadline"), seconds * 1000))]);
  if (outcome === "deadline") {
    killTree(child);
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
    child.stdout.destroy();
    child.stderr.destroy();
    cleanup();
    block(`the test gate took longer than ${seconds} seconds, so a green result cannot be confirmed`, "");
  }
  let result = null;
  try { result = JSON.parse(readFileSync(resultFile, "utf8")); } catch { /* none */ }
  cleanup();
  if (result === null) block("the test gate did not report a result, so a green run cannot be confirmed", tail.toString("utf8"));
  if (result.ran === false) { note("the test gate is not set up, so the commit was let through"); process.exit(0); }
  if (result.ok === true) process.exit(0);
  block("the test gate is red", tail.toString("utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { note(`stopped without blocking (${e?.message ?? e})`); process.exit(0); });
}
