// client/scripts/session-logo.mjs — the DevGenie logo at session start (CR-227 slice 5, BRIEF-148; owner, 2026-11-11).
//
// Run by the plugin's SessionStart hook (hooks/hooks.json, matcher startup|resume). Prints {"systemMessage": LOGO}
// only when readStatus reports a valid saved sign-in, and nothing otherwise. It sees only readStatus's metadata
// (signed in, account, expiry), never a token, and exits 0 on any error so a session start never fails because of it.
import { pathToFileURL } from "node:url";

export async function run(deps = {}) {
  const out = deps.out ?? ((s) => process.stdout.write(s));
  try {
    const L = await import("./signin-lib.mjs");
    const status = deps.status ?? (() => L.readStatus(L.makeCtx(deps)));
    if (status()?.signedIn === true) out(`${JSON.stringify({ systemMessage: L.LOGO })}\n`);
  } catch {
    // nothing: no logo is the whole failure mode
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((c) => { process.exitCode = c; }, () => { process.exitCode = 0; });
}
