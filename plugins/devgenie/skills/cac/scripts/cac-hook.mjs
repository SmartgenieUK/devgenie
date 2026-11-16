#!/usr/bin/env node
// Project PreToolUse adapter. Only Claude's Bash calls reach this hook.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const deadline = Date.now() + 6000;
function remainingMs() { return deadline - Date.now(); }
const here = dirname(fileURLToPath(import.meta.url)); // the project root is the parent of the installed .devgenie folder
const root = dirname(here);
const note = (text) => console.error(`Change admission hook: ${text}`);

function readInput() {
  return new Promise((yes, no) => {
    let size = 0, chunks = [], done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.destroy();
      if (error) no(error); else yes(Buffer.concat(chunks).toString("utf8"));
      chunks = [];
    };
    const timer = setTimeout(() => finish(new Error("input budget exhausted")), Math.max(1, remainingMs()));
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) finish(new Error("input too large")); else chunks.push(chunk);
    });
    process.stdin.on("end", () => finish());
    process.stdin.on("error", () => finish(new Error("input unavailable")));
  });
}

// Tokenise without executing shell text; operators and substitutions cannot be supported.
async function commandForm(command, stripMessageComments) {
  const tokens = [];
  let value = "", quote = "", started = false, unsafe = command.includes("\r") || command.includes("\n");
  const flush = () => { if (started) tokens.push(value); value = ""; started = false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (quote === '"' && (c === "$" || c === "`" || (c === "\\" && /[$`]/.test(command[i + 1] ?? "")))) unsafe = true;
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && /["\\$`]/.test(command[i + 1] ?? "")) value += command[++i];
      else value += c;
    } else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) flush();
    else if (/[;&|<>()]/.test(c)) { flush(); tokens.push(c); unsafe = true; }
    else if (c === "\\") { started = true; if (i + 1 < command.length) value += command[++i]; else unsafe = true; }
    else { if ("$`*?[]{}~!".includes(c)) unsafe = true; started = true; value += c; }
  }
  flush();
  if (quote) unsafe = true;
  const commits = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "git") continue;
    for (let j = i + 1; j < tokens.length && !/^[;&|<>()]$/.test(tokens[j]); j++) {
      if (tokens[j] === "commit") { commits.push(j); if (j !== i + 1 || i !== 0) unsafe = true; break; }
    }
  }
  if (!commits.length) return null;
  if (commits.length !== 1) unsafe = true;
  let all = false, amend = false;
  const messages = [];
  for (let i = commits[0] + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (["-m", "--message", "-am"].includes(t)) {
      if (t === "-am") all = true;
      if (i + 1 < tokens.length && !/^[;&|<>()]$/.test(tokens[i + 1])) messages.push(tokens[++i]); else unsafe = true;
    } else if (t.startsWith("--message=")) messages.push(t.slice(10));
    else if (t === "-a" || t === "--all") all = true;
    else if (t === "--amend") amend = true;
    else unsafe = true;
  }
  return { message: await stripMessageComments(messages.join("\n")), all, amend, unsupported: unsafe || !messages.length };
}

function readConfig(key, fallback) {
  const ms = remainingMs();
  if (ms <= 0) throw new Error("config budget exhausted");
  return new Promise((yes, no) => {
    execFile("git", ["config", "--get", key], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout: ms, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, shell: false, windowsHide: true }, (error, output) => {
      if (!error) yes(output.replace(/\r?\n$/, ""));
      else if (error.code === 1 && !error.killed && !error.signal) yes(fallback);
      else no(new Error("Could not read Git configuration."));
    });
  });
}

function probe(args) {
  const ms = remainingMs();
  if (ms <= 0) throw new Error("probe budget exhausted");
  return new Promise((yes, no) => {
    execFile("git", args, { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout: ms, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, shell: false, windowsHide: true }, (error, output) => {
      if (error) no(new Error(error.killed ? "Git probe budget exhausted" : "Git probe failed"));
      else yes(output.split("\0").filter(Boolean));
    });
  });
}

async function main() {
  let input;
  try { input = JSON.parse(await readInput()); } catch { note("input unreadable or budget exhausted; call let through"); process.exit(0); }
  if (input?.tool_name !== "Bash" || typeof input?.tool_input?.command !== "string") return;
  const checker = await import(pathToFileURL(join(root, ".devgenie/cac-check.mjs")).href);
  const off = checker.enforcementOff(root);
  let configReason = false;
  const form = await commandForm(input.tool_input.command, async (message) => {
    if (off) return checker.stripMessageComments(message);
    let config;
    try {
      // Known limit: a deliberately crafted git comment configuration can still strip a citation; out of the guard's threat model (ruled out of scope 2026-11-15).
      config = { commentChar: await readConfig("core.commentChar", "#"), commentString: await readConfig("core.commentString"), cleanup: await readConfig("commit.cleanup") };
    } catch {
      configReason = "Could not read Git configuration.";
      return checker.stripMessageComments(message);
    }
    const prepared = checker.prepareMessage(message, config);
    configReason = prepared.unsupported;
    return prepared.message;
  });
  if (!form) return;
  try {
    if (typeof input.cwd !== "string" || !isAbsolute(input.cwd) || realpathSync(resolve(input.cwd)) !== realpathSync(root)) form.unsupported = true;
  } catch { form.unsupported = true; }
  form.unsupported = configReason || form.unsupported;
  const paths = new Set();
  if (!off && !form.unsupported) {
    for (const p of await probe(["diff", "--cached", "--name-only", "-z", "--no-renames", "--ignore-submodules=none"])) paths.add(p);
    if (form.all) for (const p of await probe(["diff-files", "--name-only", "-z", "--ignore-submodules=none"])) paths.add(p);
    if (form.amend) for (const p of await probe(["diff-tree", "--root", "-m", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", "--ignore-submodules=none", "HEAD"])) paths.add(p);
  }
  if (!configReason && remainingMs() <= 0) throw new Error("overall budget exhausted");
  const result = checker.decide({ root, message: form.message, paths: [...paths], unsupported: form.unsupported, off });
  if (!result.admit) {
    // A refusal stays a refusal whatever happens to its record.
    try {
      console.error(result.reason);
      try { checker.logRefusal(root, result); } catch { note("the refusal record could not be written; the call is still refused"); }
    } finally {
      process.exit(2);
    }
  }
}

main().catch(() => { note("local check failed or budget exhausted; call let through"); process.exit(0); });
