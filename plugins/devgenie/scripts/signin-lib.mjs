// client/scripts/signin-lib.mjs — DevGenie sign-in from any device (CR-227 slice 4, BRIEF-146).
//
// Shared by signin.mjs (the command the user runs in a terminal of their own) and headers-helper.mjs (the
// command Claude Code runs to get the Authorization header). Ships byte-identical to the public plugin's
// plugins/devgenie/scripts/. Holds no method and no secret: the values below are the public client id, the
// tenant, the API audience and the server address. Node built-ins only.
//
// Rules this file keeps (docs/co-arch/DESIGN_cr227-client-signin_2026-11-09.md, revision 3):
//   - no secret ever goes in a command argument: keychain and DPAPI text travel on stdin and stdout pipes;
//   - on Linux and macOS the sign-in folder and files must be owned by the user with modes 700 and 600, are
//     never symbolic links, are checked on the opened handle, and are never chmod-ed to make things work;
//   - a lock is broken only after its owner process is confirmed to have exited, never because it is old, and
//     only by the one holder of a breaker slot (BRIEF-147): no two processes are ever inside the lock at once;
//   - error text is fixed; it never carries a token, a code, a request or response body, or an exception.

import { createHash, randomBytes } from "node:crypto";
import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TENANT = "2df6b9a3-243d-43ba-8a63-16e92f909056";

export const FIXED = Object.freeze({
  tenant: TENANT,
  authority: `https://${TENANT}.ciamlogin.com/${TENANT}/oauth2/v2.0`,
  clientId: "267d7aab-6fcc-437c-9632-e24c055f713f",
  redirectUri: "https://devgenie.smartgenie.co.uk/auth/code",
  scope: "https://devgenie.smartgenie.co.uk/mcp/mcp.access offline_access openid",
  audience: "da77c80a-f0de-4ee0-a738-06bbe477c411",
  requiredScope: "mcp.access",
  server: "https://devgenie.smartgenie.co.uk/mcp",
  // Query mode (owner, 2026-11-11). Set to "form_post" to switch the link to form post in one line.
  responseMode: null,
});

export const TOKEN_URL = `${FIXED.authority}/token`;
export const AUTHORIZE_URL = `${FIXED.authority}/authorize`;
export const CODE_PAGE_ORIGIN = "https://devgenie.smartgenie.co.uk";
export const KEYCHAIN_SERVICE = "devgenie-signin";
export const SIGNIN_PATH = join(dirname(fileURLToPath(import.meta.url)), "signin.mjs");
export const SIGNIN_COMMAND = `node "${SIGNIN_PATH}"`;
export const HELPER_FAIL = `DevGenie sign-in needed: run ${SIGNIN_COMMAND} in a terminal of your own.`;
export const FIVE_MINUTES = 5 * 60 * 1000;

// O_NOFOLLOW is not defined on Windows; the value is only used there by a test's fake file system.
export const O_NOFOLLOW = nodeFs.constants.O_NOFOLLOW ?? 0o400000;
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL } = nodeFs.constants;

/** A failure whose message is fixed text, safe to show the user. */
export class StoreError extends Error {}
const STORE_FAIL = "Could not reach the saved sign-in store.";
const LOCK_FAIL = "Another DevGenie sign-in step is running. Try again in a moment.";

// ── PKCE, the link, the pasted input ─────────────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function makePkce(random = randomBytes) {
  const verifier = b64url(random(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(random(16));
  return { verifier, challenge, state };
}

export function buildLink({ challenge, state }) {
  const q = new URLSearchParams();
  q.set("client_id", FIXED.clientId);
  q.set("response_type", "code");
  q.set("redirect_uri", FIXED.redirectUri);
  q.set("scope", FIXED.scope);
  q.set("code_challenge", challenge);
  q.set("code_challenge_method", "S256");
  q.set("state", state);
  if (FIXED.responseMode) q.set("response_mode", FIXED.responseMode);
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// The code page's own character rule and size bound (src/auth-code-page.ts).
const CODE_RE = /^[A-Za-z0-9._~-]{1,4096}$/;
const PASTE_REFUSED = "That is not a sign-in code. Copy the code from the sign-in page and try again.";

/** A bare code, or the whole code-page address under exact rules. Never echoes the input. */
export function parsePasted(input, state) {
  const s = String(input ?? "").trim();
  const refuse = { ok: false, message: PASTE_REFUSED };
  if (CODE_RE.test(s)) return { ok: true, code: s };
  if (!/^https?:\/\//i.test(s)) return refuse;
  let u;
  try { u = new URL(s); } catch { return refuse; }
  if (u.origin !== CODE_PAGE_ORIGIN || u.username || u.password || u.pathname !== "/auth/code" || u.hash) return refuse;
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes("code") || !keys.includes("state")) return refuse;
  if (u.searchParams.get("state") !== state) return refuse;
  const code = u.searchParams.get("code");
  if (!CODE_RE.test(code)) return refuse;
  return { ok: true, code };
}

// ── Token claims ─────────────────────────────────────────────────────────────────────────────────────

export function decodeJwt(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  try {
    const o = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** The access token's claims if it is for this tenant, client, audience and scope; otherwise null. */
export function checkClaims(accessToken) {
  const c = decodeJwt(accessToken);
  if (!c) return null;
  if (c.tid !== FIXED.tenant || c.azp !== FIXED.clientId || c.aud !== FIXED.audience) return null;
  if (typeof c.scp !== "string" || !c.scp.split(" ").includes(FIXED.requiredScope)) return null;
  return c;
}

/** The account to show: plain text, control characters removed, at most 254 characters. */
export function accountOf(idToken, claims) {
  const id = decodeJwt(idToken) || {};
  const pick = [id.email, id.preferred_username, claims?.preferred_username, claims?.oid].find((v) => typeof v === "string" && v);
  return String(pick || "this account").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 254);
}

/** The saved record: these fields and nothing else. */
export function recordFrom(tok, claims, account, now) {
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: now + Number(tok.expires_in) * 1000,
    tid: claims.tid, azp: claims.azp, aud: claims.aud, scp: claims.scp,
    oid: typeof claims.oid === "string" ? claims.oid : null,
    account,
  };
}

/** A loaded record the helper may use: the expected values, and an access token that still checks. */
export function recordOk(r) {
  return !!r && r.tid === FIXED.tenant && r.azp === FIXED.clientId && r.aud === FIXED.audience
    && typeof r.scp === "string" && r.scp.split(" ").includes(FIXED.requiredScope)
    && typeof r.refresh_token === "string" && Number.isFinite(r.expires_at)
    && !!checkClaims(r.access_token);
}

// ── Context (everything a test injects) ──────────────────────────────────────────────────────────────

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
function isAliveReal(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
}

export function makeCtx(d = {}) {
  return {
    platform: d.platform ?? process.platform,
    home: d.home ?? homedir(),
    fsx: d.fsx ?? nodeFs,
    spawn: d.spawn ?? spawnSync,
    getuid: d.getuid ?? (typeof process.getuid === "function" ? () => process.getuid() : () => -1),
    now: d.now ?? Date.now,
    deadline: d.deadline ?? Infinity,
    sleep: d.sleep ?? sleepReal,
    isAlive: d.isAlive ?? isAliveReal,
    tokenUrl: d.tokenUrl ?? TOKEN_URL,
    fetch: d.fetch ?? globalThis.fetch,
  };
}

// Time left before the run's deadline: at most 60 s per step, at least 1 ms.
const left = (ctx) => Math.max(1, Math.floor(Math.min(60000, ctx.deadline - ctx.now())));
const posix = (ctx) => ctx.platform !== "win32";
export const authDir = (ctx) => join(ctx.home, ".devgenie", "auth");
const fileOf = (ctx, ext) => join(authDir(ctx), `${FIXED.tenant}.${ext}`);

// ── Folder and file rules ────────────────────────────────────────────────────────────────────────────

function ensureDir(ctx) {
  const dir = authDir(ctx);
  const f = ctx.fsx;
  if (!f.existsSync(dir)) f.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!posix(ctx)) return dir;
  const st = f.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== ctx.getuid() || (st.mode & 0o777) !== 0o700) {
    throw new StoreError(`${dir} must be a folder owned by you with mode 700, not a link; fix it or remove it, then run sign-in again.`);
  }
  return dir;
}

function openChecked(ctx, path, flags, mode) {
  const f = ctx.fsx;
  let fd;
  try {
    fd = f.openSync(path, flags | (posix(ctx) ? O_NOFOLLOW : 0), mode);
  } catch (e) {
    if (e.code === "ELOOP") throw new StoreError(`${path} must not be a link; remove it, then run sign-in again.`);
    throw e;
  }
  if (posix(ctx)) {
    const st = f.fstatSync(fd);
    if (!st.isFile() || st.uid !== ctx.getuid() || (st.mode & 0o777) !== 0o600) {
      f.closeSync(fd);
      throw new StoreError(`${path} must be a file owned by you with mode 600, not a link; fix it or remove it, then run sign-in again.`);
    }
  }
  return fd;
}

function readText(ctx, path) {
  let fd;
  try {
    fd = openChecked(ctx, path, O_RDONLY);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try { return ctx.fsx.readFileSync(fd, "utf8"); } finally { ctx.fsx.closeSync(fd); }
}

function writeText(ctx, path, text) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const f = ctx.fsx;
  const fd = openChecked(ctx, tmp, O_WRONLY | O_CREAT | O_EXCL, 0o600);
  try {
    try { f.writeSync(fd, text); f.fsyncSync(fd); } finally { f.closeSync(fd); }
    f.renameSync(tmp, path);
  } catch (e) {
    try { f.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function removeFile(ctx, path) {
  try { ctx.fsx.unlinkSync(path); } catch (e) { if (e.code !== "ENOENT") throw e; }
}

// ── The three stores ─────────────────────────────────────────────────────────────────────────────────

const PS_PROTECT = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
  + "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($p))";
const PS_UNPROTECT = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
  + "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); "
  + "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($p))";
const psArgs = (script) => ["-NoProfile", "-NonInteractive", "-Command", script];
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function run(ctx, cmd, args, input) {
  const r = ctx.spawn(cmd, args, { input: input ?? "", encoding: "utf8", timeout: left(ctx), windowsHide: true });
  return { status: r.error || r.signal ? -1 : r.status, stdout: String(r.stdout ?? "") };
}

const pickRecord = (r) => ({
  access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at,
  tid: r.tid, azp: r.azp, aud: r.aud, scp: r.scp, oid: r.oid, account: r.account,
});

function parseRecord(json) {
  try { return JSON.parse(json); } catch { throw new StoreError(STORE_FAIL); }
}

export function loadRecord(ctx) {
  ensureDir(ctx);
  if (ctx.platform === "darwin") {
    const r = run(ctx, "security", ["find-generic-password", "-a", FIXED.tenant, "-s", KEYCHAIN_SERVICE, "-w"]);
    if (r.status === 44) return null; // the item could not be found
    if (r.status !== 0 || !B64.test(r.stdout.trim())) throw new StoreError(STORE_FAIL);
    return parseRecord(Buffer.from(r.stdout.trim(), "base64").toString("utf8"));
  }
  if (ctx.platform === "win32") {
    const enc = readText(ctx, fileOf(ctx, "dat"));
    if (enc === null) return null;
    const r = run(ctx, "powershell.exe", psArgs(PS_UNPROTECT), enc.trim());
    if (r.status !== 0 || !B64.test(r.stdout.trim())) throw new StoreError(STORE_FAIL);
    return parseRecord(Buffer.from(r.stdout.trim(), "base64").toString("utf8"));
  }
  const json = readText(ctx, fileOf(ctx, "json"));
  return json === null ? null : parseRecord(json);
}

export function saveRecord(ctx, rec) {
  ensureDir(ctx);
  const json = JSON.stringify(pickRecord(rec));
  const b64 = Buffer.from(json, "utf8").toString("base64");
  if (ctx.platform === "darwin") {
    const r = run(ctx, "security", ["-i"], `add-generic-password -U -a ${FIXED.tenant} -s ${KEYCHAIN_SERVICE} -w ${b64}\n`);
    const back = r.status === 0 ? loadRecord(ctx) : null;
    if (!back || back.access_token !== rec.access_token) throw new StoreError(STORE_FAIL);
    return;
  }
  if (ctx.platform === "win32") {
    const r = run(ctx, "powershell.exe", psArgs(PS_PROTECT), b64);
    if (r.status !== 0 || !B64.test(r.stdout.trim())) throw new StoreError(STORE_FAIL);
    writeText(ctx, fileOf(ctx, "dat"), r.stdout.trim());
    return;
  }
  writeText(ctx, fileOf(ctx, "json"), json);
}

export function deleteRecord(ctx) {
  ensureDir(ctx);
  if (ctx.platform === "darwin") {
    const r = run(ctx, "security", ["delete-generic-password", "-a", FIXED.tenant, "-s", KEYCHAIN_SERVICE]);
    if (r.status !== 0 && r.status !== 44) throw new StoreError(STORE_FAIL);
    return;
  }
  removeFile(ctx, fileOf(ctx, ctx.platform === "win32" ? "dat" : "json"));
}

// ── Generation and lock ──────────────────────────────────────────────────────────────────────────────

export function readGen(ctx) {
  ensureDir(ctx);
  const t = readText(ctx, fileOf(ctx, "gen"));
  const n = t === null ? 0 : parseInt(t.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function writeGen(ctx, n) {
  writeText(ctx, fileOf(ctx, "gen"), String(n));
}

// The lock and its breaker slots are files holding their maker's pid, each created whole: a private temporary is
// hard-linked into place, which fails if the path exists, so none is ever seen empty and one maker wins a path.
function createWhole(ctx, path) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const fd = openChecked(ctx, tmp, O_WRONLY | O_CREAT | O_EXCL, 0o600);
  try {
    try { ctx.fsx.writeSync(fd, String(process.pid)); } finally { ctx.fsx.closeSync(fd); }
    ctx.fsx.linkSync(tmp, path);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  } finally {
    removeFile(ctx, tmp);
  }
}

// A file's identity (device and inode, or the NTFS file id). An open handle keeps it from being reused, so "the path
// still names the file I hold open" is a comparison of identities, never of contents. An identity of 0 (a file
// system that reports none) never matches, so nothing is broken there: the safe side.
const idOf = (st) => (BigInt(st.ino) === 0n ? null : `${st.dev}:${st.ino}`);
function sameFile(ctx, path, fd) {
  let st;
  try { st = ctx.fsx.lstatSync(path, { bigint: true }); } catch (e) { if (e.code === "ENOENT") return false; throw e; }
  const id = idOf(st);
  return id !== null && id === idOf(ctx.fsx.fstatSync(fd, { bigint: true }));
}

// An open handle on the file at path if its maker has exited and the path still names it after that test: the file
// outlived its maker, which is the only process that removes its own file, so it stays until a breaker removes it
// (a slot, never). Null otherwise. The caller closes the handle.
function openDead(ctx, path) {
  let fd;
  try { fd = openChecked(ctx, path, O_RDONLY); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  let keep = false;
  try {
    const text = ctx.fsx.readFileSync(fd, "utf8").trim();
    const pid = /^\d+$/.test(text) ? Number(text) : 0;
    keep = pid > 0 && ctx.isAlive(pid) === false && sameFile(ctx, path, fd);
    return keep ? fd : null;
  } finally {
    if (!keep) ctx.fsx.closeSync(fd);
  }
}

// Breaker slots <lock>.break.0, .1, ...: a process holds slot k only if it created it after finding every lower slot
// dead. A dead slot is never removed, so nobody can create it later: at most one process holds a slot at a time. A
// breaker killed mid-break leaves its slot dead (and perhaps its temporary); the next breaker takes the next slot.
// No age rule: a live breaker can be suspended at any instruction, so age proves nothing; its exit does.
function takeBreakerSlot(ctx, lockPath) {
  for (let k = 0; ; k++) {
    const slot = `${lockPath}.break.${k}`;
    if (createWhole(ctx, slot)) return slot;
    const fd = openDead(ctx, slot);
    if (fd === null) return null; // a live breaker, or a slot just freed: wait
    ctx.fsx.closeSync(fd);
  }
}

// Removes the stale lock held open on fd, only while holding a breaker slot and only if the lock path still names
// that file: only a breaker removes a lock whose owner has exited, there is one breaker, and nobody creates the lock
// while it exists, so the unlink cannot hit a newer lock. Nothing is moved aside or linked back. True if it held a slot.
function breakStale(ctx, lockPath, fd) {
  const slot = takeBreakerSlot(ctx, lockPath);
  if (slot === null) return false;
  try {
    if (sameFile(ctx, lockPath, fd)) removeFile(ctx, lockPath);
  } finally {
    removeFile(ctx, slot);
  }
  return true;
}

/** Runs fn while holding the cross-process lock. Never breaks a lock on age; only when its owner has exited. */
export async function withLock(ctx, fn, timeoutMs) {
  const dir = ensureDir(ctx);
  const lockPath = join(dir, `${FIXED.tenant}.lock`);
  const until = Math.min(ctx.now() + timeoutMs, ctx.deadline);
  for (;;) {
    if (createWhole(ctx, lockPath)) {
      try { return await fn(); } finally { removeFile(ctx, lockPath); }
    }
    const dead = openDead(ctx, lockPath);
    if (dead !== null) {
      let broke;
      try { broke = breakStale(ctx, lockPath, dead); } finally { ctx.fsx.closeSync(dead); }
      if (broke) continue;
    }
    if (ctx.now() >= until) throw new StoreError(LOCK_FAIL);
    await ctx.sleep(100);
  }
}

// ── Token endpoint ───────────────────────────────────────────────────────────────────────────────────

async function postToken(ctx, form) {
  try {
    const res = await ctx.fetch(ctx.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(left(ctx)),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const life = Number(j?.expires_in);
    return j && typeof j.access_token === "string" && Number.isFinite(life) && life > 0 ? j : null;
  } catch {
    return null;
  }
}

export function exchangeCode(ctx, code, verifier) {
  return postToken(ctx, {
    client_id: FIXED.clientId, grant_type: "authorization_code", code,
    redirect_uri: FIXED.redirectUri, code_verifier: verifier, scope: FIXED.scope,
  });
}

export function refreshToken(ctx, refresh) {
  return postToken(ctx, { client_id: FIXED.clientId, grant_type: "refresh_token", refresh_token: refresh, scope: FIXED.scope });
}

// ── Status and sign-out ──────────────────────────────────────────────────────────────────────────────

export const STATUS_DAMAGED = "The saved sign-in is damaged or not for DevGenie; run the sign-in command again.";

/** Metadata only, never a token. A record the helper would refuse is reported as not signed in. */
export function readStatus(ctx = makeCtx()) {
  try {
    const r = loadRecord(ctx);
    if (!r) return { signedIn: false };
    if (!recordOk(r) || Number.isNaN(new Date(r.expires_at).getTime())) return { signedIn: false, problem: STATUS_DAMAGED };
    return { signedIn: true, account: String(r.account ?? ""), expiresAt: r.expires_at };
  } catch (e) {
    return { signedIn: false, problem: e instanceof StoreError ? e.message : STORE_FAIL };
  }
}

export async function signOut(ctx) {
  await withLock(ctx, async () => {
    const gen = readGen(ctx);
    deleteRecord(ctx);
    writeGen(ctx, gen + 1);
  }, 10000);
}

// ── The logo (owner, 2026-11-10; docs/co-arch/evidence/cr227-signin-logo-draft_2026-11-10.txt) ───────

export const LOGO = [
  "",
  "  ⣿⣿⣿⣿⣿⣿⣿⣿                              ⣿⣿⣿⣿⣿⣿⣿⣿                              ⣿⣿                ",
  "  ⣿⣿      ⣿⣿                          ⣿⣿                                                        ",
  "  ⣿⣿      ⣿⣿    ⣿⣿⣿⣿⣿⣿    ⣿⣿      ⣿⣿  ⣿⣿            ⣿⣿⣿⣿⣿⣿    ⣿⣿  ⣿⣿⣿⣿      ⣿⣿⣿⣿        ⣿⣿⣿⣿⣿⣿  ",
  "  ⣿⣿      ⣿⣿  ⣿⣿      ⣿⣿  ⣿⣿      ⣿⣿  ⣿⣿    ⣿⣿⣿⣿  ⣿⣿      ⣿⣿  ⣿⣿⣿⣿    ⣿⣿      ⣿⣿      ⣿⣿      ⣿⣿",
  "  ⣿⣿      ⣿⣿  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿  ⣿⣿      ⣿⣿  ⣿⣿      ⣿⣿  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿  ⣿⣿      ⣿⣿      ⣿⣿      ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "  ⣿⣿      ⣿⣿  ⣿⣿            ⣿⣿  ⣿⣿    ⣿⣿      ⣿⣿  ⣿⣿          ⣿⣿      ⣿⣿      ⣿⣿      ⣿⣿        ",
  "  ⣿⣿⣿⣿⣿⣿⣿⣿      ⣿⣿⣿⣿⣿⣿⣿⣿      ⣿⣿        ⣿⣿⣿⣿⣿⣿⣿⣿    ⣿⣿⣿⣿⣿⣿⣿⣿  ⣿⣿      ⣿⣿    ⣿⣿⣿⣿⣿⣿      ⣿⣿⣿⣿⣿⣿⣿⣿",
  "",
  "  Agentic Code Engineering",
  "",
].join(String.fromCharCode(10));
