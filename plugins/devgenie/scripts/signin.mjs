#!/usr/bin/env node
// client/scripts/signin.mjs — sign in to DevGenie from any device (CR-227 slice 4, BRIEF-146).
//
//   node signin.mjs              sign in: prints a link, reads the code from the keyboard without echo
//   node signin.mjs --sign-out   remove the sign-in from this machine
//   node signin.mjs --status     whether a sign-in is saved, for which account, and until when
//
// Run it in a terminal of your own, never through Claude: the code must not pass through the model. The
// PKCE verifier and state live in memory only. Nothing this prints carries a token, the code or the verifier.

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  makeCtx, makePkce, buildLink, parsePasted, exchangeCode, checkClaims, accountOf, recordFrom,
  readGen, saveRecord, withLock, signOut, readStatus, StoreError, LOGO,
} from "./signin-lib.mjs";

const NOT_TTY = "Run this in a terminal of your own; it reads the sign-in code from the keyboard.";
const REFUSED = "The code was refused or has expired. Start sign-in again.";
const BAD_TOKEN = "The sign-in returned a token DevGenie cannot use. Nothing was saved.";
const SIGNED_OUT_MEANWHILE = "A sign-out happened while you were signing in. Nothing was saved; run sign-in again.";
const SIGNED_OUT = "Signed out of DevGenie on this machine. This is a local sign-out: an open Claude Code session can keep working for up to an hour, so restart open sessions.";

/** Reads one line without echo (raw mode). Enter ends; Backspace deletes; Ctrl-C aborts. */
function readHidden(stdin) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") { done(); resolve(buf.replace(/\[20[01]~/g, "")); return; }
        if (ch === "\u0003") { done(); reject(Object.assign(new Error("aborted"), { aborted: true })); return; }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else if (ch >= " " && buf.length < 8192) buf += ch;
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readVisible(stdin) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin });
    rl.once("line", (line) => { rl.close(); resolve(line); });
    rl.once("close", () => resolve(""));
  });
}

async function showLogo(out, sleep) {
  const lines = LOGO.split("\n").length;
  out(`\x1b[2m${LOGO}\x1b[0m\n`);
  await sleep(1500);
  out(`\x1b[${lines}A\x1b[J`);
}

export async function runSignin(argv, deps = {}) {
  const ctx = makeCtx(deps);
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const err = deps.err ?? ((s) => process.stderr.write(s));
  const env = deps.env ?? process.env;
  const stdin = deps.stdin ?? process.stdin;
  const stdinIsTTY = deps.stdinIsTTY ?? stdin.isTTY === true;
  const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY === true;
  const readSecret = deps.readSecret ?? (() => readHidden(stdin));
  const readLine = deps.readLine ?? (() => readVisible(stdin));
  const random = deps.random ?? randomBytes;

  try {
    if (argv.includes("--sign-out")) {
      await signOut(ctx);
      out(`${SIGNED_OUT}\n`);
      return 0;
    }
    if (argv.includes("--status")) {
      const s = readStatus(ctx);
      if (s.signedIn) out(`Signed in as ${s.account}; the access token is valid until ${new Date(s.expiresAt).toISOString()} (it refreshes on use).\n`);
      else out(s.problem ? `Not signed in: ${s.problem}\n` : "Not signed in.\n");
      return 0;
    }
    if (stdinIsTTY !== true) {
      err(`${NOT_TTY}\n`);
      return 2;
    }

    const gen0 = readGen(ctx);
    const pk = makePkce(random);
    out("Open this link on any device, sign in, then copy the code the page shows.\n\n");
    out(`${buildLink(pk)}\n\n`);
    out("Only paste a code from a sign-in you started here.\nCode: ");
    const input = await readSecret();
    out("\n");

    const pasted = parsePasted(input, pk.state);
    if (!pasted.ok) { err(`${pasted.message}\n`); return 1; }
    const tok = await exchangeCode(ctx, pasted.code, pk.verifier);
    if (!tok) { err(`${REFUSED}\n`); return 1; }
    const claims = checkClaims(tok.access_token);
    if (!claims || typeof tok.refresh_token !== "string") { err(`${BAD_TOKEN}\n`); return 1; }
    const account = accountOf(tok.id_token, claims);

    out(`Sign in as ${account}? [y/N] `);
    const answer = String(await readLine()).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") { out("Not saved.\n"); return 1; }

    const rec = recordFrom(tok, claims, account, ctx.now());
    const saved = await withLock(ctx, async () => {
      if (readGen(ctx) !== gen0) return false;
      saveRecord(ctx, rec);
      return true;
    }, 10000);
    if (!saved) { err(`${SIGNED_OUT_MEANWHILE}\n`); return 1; }

    if (stdoutIsTTY === true && !env.NO_COLOR) await showLogo(out, ctx.sleep);
    out(`Signed in to DevGenie as ${account}. Restart any open Claude Code session to use it.\n`);
    if (ctx.platform !== "win32" && ctx.platform !== "darwin") {
      out("The sign-in is kept under ~/.devgenie/auth/, readable only by you; it is as private as this home folder.\n");
    }
    return 0;
  } catch (e) {
    if (e?.aborted) { err("Sign-in cancelled.\n"); return 130; }
    err(e instanceof StoreError ? `${e.message}\n` : "Sign-in did not complete. Start it again.\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSignin(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
