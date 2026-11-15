#!/usr/bin/env node
// Status input becomes one safe display line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { input = {}; }
const name = [input?.model?.display_name, input?.model?.id].find((v) => typeof v === "string" && v.trim()) || "model?";
const model = name.replace(/[\r\n\t]/g, " ");
const percentage = input?.context_window?.used_percentage;
let off = process.env.DEVGENIE_SESSIONS === "off";
try {
  const project = process.env.CLAUDE_PROJECT_DIR || input?.workspace?.project_dir || input?.cwd || process.cwd();
  off ||= existsSync(join(project, ".devgenie/sessions.off"));
} catch { /* Invalid project input leaves the safe display available. */ }
console.log(off ? model : `${model} · ctx ${Number.isFinite(percentage) ? `${Math.round(percentage)}%` : "—"}`);
