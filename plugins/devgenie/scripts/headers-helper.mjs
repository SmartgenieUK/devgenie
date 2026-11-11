#!/usr/bin/env node
// client/scripts/headers-helper.mjs — the plugin's MCP headersHelper (CR-227 slice 4, BRIEF-146).
//
// Claude Code runs this for the devgenie-core server on each connection. On success it prints exactly one
// line, {"Authorization":"Bearer <access token>"}; it never prints the refresh token. It refuses unless Claude
// Code says the server is exactly https://devgenie.smartgenie.co.uk/mcp and the saved sign-in is for the
// expected tenant, client, audience and scope. With under five minutes left it refreshes under the lock, and
// never recreates a sign-in that was signed out. Every failure prints one fixed sentence on stderr and exits
// 1. The whole run stays inside 8 seconds (Claude Code gives up after 10).

import { pathToFileURL } from "node:url";
import {
  makeCtx, loadRecord, saveRecord, recordOk, withLock, refreshToken, checkClaims, FIXED, FIVE_MINUTES, HELPER_FAIL,
} from "./signin-lib.mjs";

export async function runHelper(deps = {}) {
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const err = deps.err ?? ((s) => process.stderr.write(s));
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const ctx = makeCtx({ ...deps, now, deadline: deps.deadlineMs ?? now() + 8000 });
  const fail = () => { err(`${HELPER_FAIL}\n`); return 1; };

  try {
    if (env.CLAUDE_CODE_MCP_SERVER_URL !== FIXED.server) return fail();
    let rec = loadRecord(ctx);
    if (!recordOk(rec)) return fail();

    if (rec.expires_at - ctx.now() < FIVE_MINUTES) {
      if (deps.beforeLock) await deps.beforeLock();
      rec = await withLock(ctx, async () => {
        const cur = loadRecord(ctx);
        if (!recordOk(cur)) return null; // signed out meanwhile: never recreate
        if (cur.expires_at - ctx.now() >= FIVE_MINUTES) return cur; // another session refreshed it
        const tok = await refreshToken(ctx, cur.refresh_token);
        if (!tok || !checkClaims(tok.access_token)) return null;
        const next = {
          ...cur,
          access_token: tok.access_token,
          expires_at: ctx.now() + Number(tok.expires_in) * 1000,
          refresh_token: typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : cur.refresh_token,
        };
        saveRecord(ctx, next);
        return next;
      }, 3000);
      if (!rec) return fail();
    }

    out(`${JSON.stringify({ Authorization: `Bearer ${rec.access_token}` })}\n`);
    return 0;
  } catch {
    return fail();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHelper().then((code) => { process.exitCode = code; });
}
