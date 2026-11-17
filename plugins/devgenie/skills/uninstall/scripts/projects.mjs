// A local, best-effort project list. Never inspect neighbouring home contents.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const CREATED_PATHS = [".devgenie", ".claude", ".claude/hooks", ".claude/settings.json", "CLAUDE.md"];
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const within = (base, path) => { const r = relative(base, path); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep)); };

export function protectedPath(path) {
  return within(resolve(homedir(), ".devgenie/auth"), resolve(path));
}

export function info(path) {
  if (protectedPath(path)) throw new Error("Sign-in storage is outside project cleanup.");
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function readProjects() {
  const directory = join(homedir(), ".devgenie"), file = join(directory, "projects.json");
  const parent = info(directory);
  if (parent && (parent.isSymbolicLink() || !parent.isDirectory())) throw new Error("The project-list folder is linked or cannot be checked.");
  const stat = info(file);
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)) throw new Error("The project list is linked or cannot be checked.");
  let data = { version: 1, projects: [] };
  if (stat) {
    try { data = JSON.parse(readFileSync(file, "utf8")); }
    catch { throw new Error("The project list cannot be read as JSON."); }
  }
  if (!plain(data) || data.version !== 1 || !Array.isArray(data.projects)) throw new Error("The project list has an unexpected shape.");
  const roots = new Set();
  for (const entry of data.projects) {
    if (!plain(entry) || typeof entry.root !== "string" || !isAbsolute(entry.root) || protectedPath(entry.root) ||
        typeof entry.recorded !== "string" || !Number.isFinite(Date.parse(entry.recorded)) ||
        !Array.isArray(entry.created) || entry.created.some((p) => !CREATED_PATHS.includes(p)) ||
        new Set(entry.created).size !== entry.created.length || roots.has(entry.root)) throw new Error("The project list has an unsafe entry.");
    roots.add(entry.root);
  }
  return { directory, file, data, exists: !!stat };
}

export function writeProjects(store, data) {
  // Recheck the two exact home paths; never enumerate their parent.
  readProjects();
  mkdirSync(store.directory, { recursive: true });
  const temporary = store.file + ".tmp-" + process.pid + "-" + randomUUID();
  let made = false;
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    made = true;
    renameSync(temporary, store.file);
    made = false;
  } finally { if (made) rmSync(temporary, { force: true }); }
}

export async function recordProject(projectRoot) {
  try {
    if (protectedPath(projectRoot)) return;
    const root = realpathSync(resolve(projectRoot));
    if (protectedPath(root) || !info(root)?.isDirectory()) return;
    const store = readProjects();
    const projects = store.data.projects.filter((entry) => info(entry.root) !== null);
    if (!projects.some((entry) => entry.root === root)) {
      const created = CREATED_PATHS.filter((p) => info(join(root, p)) === null);
      projects.push({ root, recorded: new Date().toISOString(), created });
    }
    if (JSON.stringify(projects) !== JSON.stringify(store.data.projects)) writeProjects(store, { version: 1, projects });
  } catch { /* Recording must never affect an installer. */ }
}
