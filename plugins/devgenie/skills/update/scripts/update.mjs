#!/usr/bin/env node
// update.mjs - updates the DevGenie plugin through the Claude Code command line, then prints the release notes for
// every version it moved through, read from the marketplace's own copy of CHANGELOG.md on this machine.
//
// Holds no method and no credential, writes nothing into the project and opens no network connection itself; the
// claude command does the update. It never accepts a marketplace-declared command on the developer's behalf: if the
// update needs a person to confirm one, it stops and prints the commands to run in a terminal of their own.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// The marketplace DevGenie is published from; used only for the commands shown before the installation is identified.
const defaultMarketplace = "smartgenie";
// A marketplace name this script will put into a command.
const MARKETPLACE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// The installation scopes the claude command accepts.
const SCOPES = ["user", "project", "local", "managed"];

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 200);

function fail(reason, found) {
  const marketplace = found ? found.marketplace : defaultMarketplace;
  const scope = found ? found.scope : "user";
  console.log(reason);
  if (!found) console.log("These are the usual commands, because the installed DevGenie could not be identified.");
  console.log("Run these commands in a terminal of your own:");
  console.log(`  claude plugin marketplace update ${marketplace}`);
  console.log(`  claude plugin update devgenie@${marketplace} --scope ${scope}`);
  process.exit(1);
}

function claude(args) {
  return spawnSync("claude", args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120000,
    input: "",
  });
}

const failed = (r) => Boolean(r.error) || r.status !== 0;
// A plain reason for a failed call; the command's own output is never repeated, so it cannot mislead.
function why(step, r) {
  if (r.error && r.error.code === "ETIMEDOUT") return `${step} did not finish in time.`;
  if (r.error) return `${step} could not be run (${oneLine(r.error.code ?? r.error.message)}).`;
  if (/confirm/i.test(`${r.stdout}\n${r.stderr}`)) return `${step} needs a person to confirm a command the marketplace declares, so it was not done.`;
  return `${step} failed with exit status ${r.status}.`;
}

function parseJson(r) {
  try { return JSON.parse(r.stdout); } catch { return undefined; }
}

function parseVersion(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(typeof v === "string" ? v : "");
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
const cmp = (a, b) => { const x = parseVersion(a), y = parseVersion(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// The one installed DevGenie entry, or a plain reason why it cannot be used.
function findPlugin(list) {
  if (!Array.isArray(list)) return "The installed plugin list could not be read.";
  const hits = list.filter((p) => p && typeof p.id === "string" && p.id.startsWith("devgenie@"));
  if (hits.length === 0) return "DevGenie is not in the installed plugin list.";
  if (hits.length > 1) return "More than one DevGenie installation is listed, so the one to update is not clear.";
  const { id, version, scope, installPath } = hits[0];
  const marketplace = id.slice("devgenie@".length);
  if (!MARKETPLACE_NAME.test(marketplace)) return "The installed DevGenie names a marketplace this command cannot use.";
  if (!parseVersion(version)) return "The installed DevGenie version could not be read.";
  if (!SCOPES.includes(scope)) return "The installed DevGenie has a scope this command cannot use.";
  return { id, version, scope, marketplace, installPath };
}

// The numbered sections of a changelog: version to its heading and body. Duplicates are reported, not merged.
// Lines inside a fenced code block are body text, never headings.
function sections(text) {
  const found = new Map();
  let current = null, duplicate = false, fence = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence || f) {
      if (!fence) fence = f[1];
      else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      if (current) found.get(current).push(line);
      continue;
    }
    const m = /^ {0,3}##[ \t]+(\d+\.\d+\.\d+)[ \t]*$/.exec(line);
    if (m && parseVersion(m[1])) {
      if (found.has(m[1])) duplicate = true;
      current = m[1];
      found.set(current, []);
    } else if (/^ {0,3}##([ \t]|$)/.test(line)) current = null;
    else if (current) found.get(current).push(line);
  }
  return { found, duplicate };
}

function readChangelog(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function main() {
  const before = claude(["plugin", "list", "--json"]);
  if (before.error && before.error.code === "ENOENT") fail("Could not run the claude command from here.");
  if (failed(before)) fail(why("Listing the installed plugins", before));
  const found = findPlugin(parseJson(before));
  if (typeof found === "string") fail(found);
  const old = found.version;

  const refresh = claude(["plugin", "marketplace", "update", found.marketplace]);
  if (failed(refresh)) fail(why("Refreshing the marketplace", refresh), found);
  const upgrade = claude(["plugin", "update", found.id, "--scope", found.scope]);
  if (failed(upgrade)) fail(why("Updating the plugin", upgrade), found);

  const after = claude(["plugin", "list", "--json"]);
  if (failed(after)) fail(`DevGenie may have been updated, but ${why("listing the installed plugins", after)}`, found);
  const latest = findPlugin(parseJson(after));
  if (typeof latest === "string" || latest.id !== found.id || latest.scope !== found.scope) fail("DevGenie may have been updated, but its new version could not be read.", found);
  const now = latest.version;
  if (cmp(now, old) < 0) fail(`The plugin list shows DevGenie ${now}, older than ${old}.`, found);

  const list = claude(["plugin", "marketplace", "list", "--json"]);
  if (failed(list)) fail(`DevGenie may have been updated, but ${why("listing the marketplaces", list)}`, found);
  const markets = parseJson(list);
  const matches = Array.isArray(markets) ? markets.filter((m) => m && m.name === found.marketplace) : [];
  const market = matches.length === 1 ? matches[0] : null;
  if (!market || typeof market.installLocation !== "string" || !isAbsolute(market.installLocation)) fail("DevGenie may have been updated, but its marketplace folder could not be found.", found);

  const same = cmp(now, old) === 0;
  const notes = [];
  const text = readChangelog(join(market.installLocation, "CHANGELOG.md"));
  if (text === null) notes.push("The release notes could not be read from the marketplace's CHANGELOG.md.");
  else {
    const { found: secs, duplicate } = sections(text);
    if (duplicate) notes.push("The changelog lists a version more than once, so its release notes are not shown.");
    else {
      if (!secs.has(now)) notes.push(`There are no release notes for ${now} in the changelog.`);
      const wanted = same ? [now] : [...secs.keys()].filter((v) => cmp(v, old) > 0 && cmp(v, now) <= 0);
      wanted.sort((a, b) => cmp(b, a));
      for (const v of wanted.filter((w) => secs.has(w))) {
        const body = secs.get(v).join("\n").trim();
        notes.push(body ? `## ${v}\n\n${body}` : `The release notes for ${v} are empty.`);
      }
    }
  }

  const out = [same ? `DevGenie is already up to date at ${now}.` : `DevGenie updated from ${old} to ${now}.`, ...notes];
  if (!same) out.push(`Restart Claude Code to use DevGenie ${now}.`);
  console.log(out.join("\n\n"));
}

try {
  main();
} catch (err) {
  fail(`The update could not be finished: ${oneLine(err.message)}.`);
}
