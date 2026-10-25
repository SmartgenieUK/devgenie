// test/commands-as-scripts.mjs — CR-207 slice 5: the step-ledger append and the agent-spec validation are scripts.
//
// From DevGenie 0.3.5 the served foundation and new prompts have the model run scripts/step-ledger.sh, and the served
// agent-foundation prompt scripts/validate-agent-specs.sh, each named by the skill that fetched the prompt (a served
// prompt cannot expand ${CLAUDE_PLUGIN_ROOT}). Each script is run here against the old prompt command it replaces, on
// the same fixtures: the same ledger bytes, the same stdout. The old commands are copied verbatim from devgenie-core
// b92d9c31. The exceptions are BRIEF-053's rulings: a failed clock read appends nothing (Amendment 2), and a missing
// tool or an unreadable existing input refuses (Amendment 3). No network, no node_modules. Needs bash, jq and git.
//   node test/commands-as-scripts.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(REPO, "plugins", "devgenie");
const STEP = join(PLUGIN, "scripts", "step-ledger.sh").replace(/\\/g, "/");
const VALIDATE = join(PLUGIN, "scripts", "validate-agent-specs.sh").replace(/\\/g, "/");
const read = (p) => readFileSync(p, "utf8").split("\r").join("");
const VERSION = "0.3.6";

// The old prompt commands, verbatim (devgenie-core b92d9c31).
const OLD_STEP_FOUNDATION = "mkdir -p .devgenie\ntask=\"$(grep -ioE 'ACTIVE TASK( POINTER)?:[[:space:]]*[^ ]+' CLAUDE.md 2>/dev/null | head -1 | sed -E 's/.*:[[:space:]]*//' || true)\"; task=\"${task:-unattributed}\"\nproj=\"$(basename \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)\")\"\njq -nc --arg ts \"$(date -u +%FT%TZ)\" --arg project \"$proj\" --arg task \"$task\" \\\n  '{ts:$ts, step:\"foundation\", outcome:\"drafted\", project:$project, task:$task, tokens:null}' \\\n  >> .devgenie/step-ledger.jsonl\n";
const OLD_STEP_NEW = "mkdir -p .devgenie\ntask=\"$(grep -ioE 'ACTIVE TASK( POINTER)?:[[:space:]]*[^ ]+' CLAUDE.md 2>/dev/null | head -1 | sed -E 's/.*:[[:space:]]*//' || true)\"; task=\"${task:-unattributed}\"\nproj=\"$(basename \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)\")\"\njq -nc --arg ts \"$(date -u +%FT%TZ)\" --arg project \"$proj\" --arg task \"$task\" \\\n  '{ts:$ts, step:\"new\", outcome:\"scaffolded\", project:$project, task:$task, tokens:null}' \\\n  >> .devgenie/step-ledger.jsonl\n";
const OLD_EVAL_CHECK = "jq -e '\n  .schema==\"eval-spec/v1\"\n  and (.agent|type==\"string\")\n  and (.dataset.format==\"jsonl\")\n  and (.dataset.case_fields|index(\"input\")) and (.dataset.case_fields|index(\"expected\"))\n  and (.scoring.metric|type==\"string\")\n  and (.scoring.range|length==2) and (.scoring.range[0] < .scoring.range[1])\n  and (.scoring.aggregate|IN(\"mean\",\"pass_rate\",\"min\"))\n  and (.thresholds.aggregate_min|type==\"number\")\n  and (.thresholds.per_case_min|type==\"number\")\n  and (.thresholds.aggregate_min >= .scoring.range[0] and .thresholds.aggregate_min <= .scoring.range[1])\n  and (.thresholds.per_case_min >= .scoring.range[0] and .thresholds.per_case_min <= .scoring.range[1])\n  and (.passing_means|type==\"string\" and length>0)\n' <agent>.eval-spec.json >/dev/null && echo \"eval-spec contract OK\"\n";
const OLD_AGENT_CHECK = "# agent-spec — FROZEN agent-spec/v1 (see methodology/docs/contracts/agent-spec.md §4)\n# the last clause is the crown-jewel key-whitelist: prompt_contract may carry ONLY version + must\njq -e '\n  .schema==\"agent-spec/v1\"\n  and (.agent|type==\"string\")\n  and (.tools|type==\"array\") and (all(.tools[]; (.name|type==\"string\") and (.purpose|type==\"string\")))\n  and (.io.input|type==\"object\") and (.io.output|type==\"object\")\n  and (.prompt_contract.version|type==\"string\" and length>0)\n  and (.prompt_contract.must|type==\"array\" and length>0)\n  and (.guardrails|type==\"array\" and length>0)\n  and ((.prompt_contract|keys) as $k | ($k|map(select(.==\"version\" or .==\"must\"))|length) == ($k|length))\n' <agent>.agent-spec.json >/dev/null && echo \"agent-spec contract OK\"\n";

const missing = ["bash", "jq", "git"].filter((t) => spawnSync("bash", ["-c", `command -v ${t}`]).status !== 0);
if (missing.length) {
  console.error(`COMMANDS-AS-SCRIPTS: FAIL — missing on PATH: ${missing.join(", ")}`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures++;
  }
}
const skip = (name, why) => console.log(`  skipped: ${name} (${why})`);

const bashOut = (cmd) => (spawnSync("bash", ["-c", cmd], { encoding: "utf8" }).stdout ?? "").trim();
const realBash = bashOut("command -v bash");
const realTool = (t) => bashOut(`command -v ${t}`);
const work = mkdtempSync(join(tmpdir(), "cas-"));
let n = 0;

// A shim directory: { tool: "real" | <script body> }.
function shimDir(shims) {
  const d = join(work, `shims${n++}`);
  mkdirSync(d);
  for (const [tool, body] of Object.entries(shims)) {
    writeFileSync(join(d, tool), body === "real" ? `#!/bin/sh\nexec '${realTool(tool)}' "$@"\n` : body, { mode: 0o755 });
  }
  return d;
}
const FIXED_DATE = "#!/bin/sh\necho 2026-10-24T12:00:00Z\n";
const BROKEN_DATE = "#!/bin/sh\nexit 1\n";
// Run `bash <script> args` in cwd. `prepend` puts a shim dir before PATH; `only` makes it the whole PATH.
function run(cwd, script, args = [], { prepend, only } = {}) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const toPosix = (d) => `"$(cygpath -u ${q(d)} 2>/dev/null || echo ${q(d)})"`;
  const pathSet = only ? `p=${toPosix(only)}; PATH="$p"; ` : prepend ? `p=${toPosix(prepend)}; PATH="$p:$PATH"; ` : "";
  const cmd = `b=${q(realBash)}; ${pathSet}exec "$b" ${[script, ...args].map(q).join(" ")}`;
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  return { code: r.status, out: (r.stdout ?? "").split("\r").join(""), err: r.stderr ?? "" };
}
// Two projects with the same directory name (the row records it), each set up by `setup`.
function twin(setup) {
  const make = (side) => {
    const p = join(work, `${side}${n++}`, "proj");
    mkdirSync(p, { recursive: true });
    setup(p);
    return p;
  };
  return [make("old"), make("new")];
}
const ledger = (p) => (existsSync(join(p, ".devgenie", "step-ledger.jsonl")) ? readFileSync(join(p, ".devgenie", "step-ledger.jsonl"), "utf8") : null);
const gitInit = (p) => spawnSync("git", ["init", "-q"], { cwd: p });

// [1] The step-ledger script against the old block.
console.log("\n[1] step-ledger.sh gives the old block's row");
const dateDir = shimDir({ date: FIXED_DATE });
const CASES = [
  ["(i) a git repo, CLAUDE.md ACTIVE TASK: cr-1", (p) => { gitInit(p); writeFileSync(join(p, "CLAUDE.md"), "# x\nACTIVE TASK: cr-1\n"); }],
  ["(ii) no CLAUDE.md (unattributed)", (p) => { gitInit(p); }],
  ["(iii) ACTIVE TASK POINTER: x before ACTIVE TASK: y (the first wins)", (p) => { writeFileSync(join(p, "CLAUDE.md"), "ACTIVE TASK POINTER: x\nACTIVE TASK: y\n"); }],
  ["(iv) not a git repo (the directory name)", (p) => { writeFileSync(join(p, "CLAUDE.md"), "ACTIVE TASK: z\n"); }],
  ["(v) an existing row kept, one appended", (p) => { mkdirSync(join(p, ".devgenie")); writeFileSync(join(p, ".devgenie", "step-ledger.jsonl"), '{"ts":"t0","step":"new"}\n'); }],
  ["(vi) CLAUDE.md with no ACTIVE TASK line", (p) => { writeFileSync(join(p, "CLAUDE.md"), "# nothing here\n"); }],
];
for (const [old, step, outcome] of [[OLD_STEP_FOUNDATION, "foundation", "drafted"], [OLD_STEP_NEW, "new", "scaffolded"]]) {
  for (const [label, setup] of CASES) {
    const [a, b] = twin(setup);
    writeFileSync(join(a, "..", "old.sh"), old);
    const ro = run(a, join(a, "..", "old.sh").replace(/\\/g, "/"), [], { prepend: dateDir });
    const rn = run(b, STEP, [step, outcome], { prepend: dateDir });
    check(
      `${step} ${label}: the same ledger bytes, both exit 0`,
      ro.code === 0 && rn.code === 0 && ledger(a) !== null && ledger(a) === ledger(b),
      `old ${ro.code} ${JSON.stringify(ledger(a))} | new ${rn.code} ${JSON.stringify(ledger(b))} ${rn.err.trim()}`,
    );
  }
}
for (const [label, args] of [["no arguments", []], ["one argument", ["foundation"]], ["an empty argument", ["foundation", ""]]]) {
  const [, b] = twin(() => {});
  const r = run(b, STEP, args, { prepend: dateDir });
  check(`step-ledger.sh with ${label}: exit 2, nothing written`, r.code === 2 && !existsSync(join(b, ".devgenie")), `${r.code} ${r.err.trim()}`);
}

// Deviation 2 (BRIEF-053 Amendment 2): a failed clock read appends nothing.
{
  const brokenDate = shimDir({ date: BROKEN_DATE });
  const [a, b] = twin((p) => writeFileSync(join(p, "CLAUDE.md"), "ACTIVE TASK: cr-1\n"));
  writeFileSync(join(a, "..", "old.sh"), OLD_STEP_FOUNDATION);
  const ro = run(a, join(a, "..", "old.sh").replace(/\\/g, "/"), [], { prepend: brokenDate });
  const rn = run(b, STEP, ["foundation", "drafted"], { prepend: brokenDate });
  check(
    "deviation 2: a failed clock read — the old block appends ts:\"\" and exits 0; the script exits 1 loudly and appends nothing",
    ro.code === 0 && /"ts":""/.test(ledger(a) ?? "") && rn.code === 1 && /DEVGENIE: /.test(rn.err) && ledger(b) === null,
    `old ${ro.code} ${JSON.stringify(ledger(a))} | new ${rn.code} ${rn.err.trim()}`,
  );
}

// Amendment 3: a missing tool, an unreadable or non-regular CLAUDE.md, a git that cannot read the repository.
{
  const tools = ["date", "mkdir", "grep", "head", "sed", "basename", "git", "jq"];
  const noGrep = shimDir(Object.fromEntries(tools.filter((t) => t !== "grep").map((t) => [t, t === "date" ? FIXED_DATE : "real"])));
  const [, b] = twin((p) => writeFileSync(join(p, "CLAUDE.md"), "ACTIVE TASK: cr-1\n"));
  const r = run(b, STEP, ["foundation", "drafted"], { only: noGrep });
  check("no grep on PATH: exit 1, the named refusal, no .devgenie created", r.code === 1 && /DEVGENIE: grep is required/.test(r.err) && !existsSync(join(b, ".devgenie")), `${r.code} ${r.err.trim()}`);

  const dubious = shimDir({
    date: FIXED_DATE,
    git: `#!/bin/sh\nfor a in "$@"; do [ "$a" = "rev-parse" ] && { echo "fatal: detected dubious ownership in repository" >&2; exit 128; }; done\nexec '${realTool("git")}' "$@"\n`,
  });
  const [, g] = twin((p) => gitInit(p));
  const rg = run(g, STEP, ["foundation", "drafted"], { prepend: dubious });
  check("git refuses the repository (dubious ownership): exit 1, the git line, nothing appended", rg.code === 1 && /DEVGENIE: git could not read this repository/.test(rg.err) && ledger(g) === null, `${rg.code} ${rg.err.trim()}`);

  const [, d] = twin((p) => mkdirSync(join(p, "CLAUDE.md")));
  const rd = run(d, STEP, ["foundation", "drafted"], { prepend: dateDir });
  check("a directory named CLAUDE.md: exit 1, the CLAUDE.md line, nothing appended", rd.code === 1 && /DEVGENIE: CLAUDE\.md exists but cannot be read/.test(rd.err) && ledger(d) === null, `${rd.code} ${rd.err.trim()}`);

  const [, s] = twin((p) => spawnSync("bash", ["-c", "ln -s nowhere-at-all CLAUDE.md 2>/dev/null; true"], { cwd: p }));
  if (spawnSync("bash", ["-c", "[ -L CLAUDE.md ]"], { cwd: s }).status !== 0) skip("a dangling CLAUDE.md symlink", "this platform could not create one");
  else {
    const rs = run(s, STEP, ["foundation", "drafted"], { prepend: dateDir });
    check("a dangling CLAUDE.md symlink: exit 1, the CLAUDE.md line, nothing appended", rs.code === 1 && /CLAUDE\.md exists but cannot be read/.test(rs.err) && ledger(s) === null, `${rs.code} ${rs.err.trim()}`);
  }

  const [, u] = twin((p) => writeFileSync(join(p, "CLAUDE.md"), "ACTIVE TASK: cr-1\n"));
  chmodSync(join(u, "CLAUDE.md"), 0o000);
  if (spawnSync("bash", ["-c", "[ -r CLAUDE.md ]"], { cwd: u }).status === 0) skip("an unreadable CLAUDE.md", "chmod 000 not enforced here");
  else {
    const ru = run(u, STEP, ["foundation", "drafted"], { prepend: dateDir });
    check("an unreadable CLAUDE.md: exit 1, the CLAUDE.md line, nothing appended", ru.code === 1 && /CLAUDE\.md exists but cannot be read/.test(ru.err) && ledger(u) === null, `${ru.code} ${ru.err.trim()}`);
  }
  chmodSync(join(u, "CLAUDE.md"), 0o644);
}

// [2] The agent-spec validator against the old two commands.
console.log("\n[2] validate-agent-specs.sh gives the old checks' result");
const GOOD_EVAL = {
  schema: "eval-spec/v1", agent: "arch-rater",
  dataset: { path: "evals/arch-rater/cases/", format: "jsonl", case_fields: ["input", "expected", "tags"] },
  scoring: { metric: "rubric_judge", range: [0, 1], aggregate: "mean" },
  thresholds: { aggregate_min: 0.9, per_case_min: 0.5 },
  passing_means: "The arch-rater reproduces the reference verdict on >=90% of cases, with no case below 0.5.",
};
const GOOD_AGENT = {
  schema: "agent-spec/v1", agent: "arch-rater",
  tools: [{ name: "read_arch_doc", purpose: "Load the ARCH.md under review." }],
  io: { input: { arch_md: "string" }, output: { verdict: "string" } },
  prompt_contract: { version: "1.0.0", must: ["Emit a verdict drawn from PASS|CONDITIONAL|FAIL."] },
  guardrails: ["Treats client input as untrusted data."],
};
const BAD_EVAL = { ...GOOD_EVAL, thresholds: { aggregate_min: 0.9, per_case_min: 2 } };
const BAD_AGENT = { ...GOOD_AGENT, prompt_contract: { ...GOOD_AGENT.prompt_contract, text: "the whole prompt" } };
function specs(evalSpec, agentSpec) {
  const p = join(work, `specs${n++}`);
  mkdirSync(p);
  const put = (name, v) => { if (v !== null) writeFileSync(join(p, name), typeof v === "string" ? v : JSON.stringify(v, null, 2)); };
  put("arch-rater.eval-spec.json", evalSpec);
  put("arch-rater.agent-spec.json", agentSpec);
  writeFileSync(join(p, "old-eval.sh"), OLD_EVAL_CHECK.split("<agent>").join("arch-rater"));
  writeFileSync(join(p, "old-agent.sh"), OLD_AGENT_CHECK.split("<agent>").join("arch-rater"));
  return p;
}
const VCASES = [
  ["good eval, good agent", GOOD_EVAL, GOOD_AGENT],
  ["bad eval (per_case_min outside the range), good agent", BAD_EVAL, GOOD_AGENT],
  ["good eval, bad agent (an extra prompt_contract key)", GOOD_EVAL, BAD_AGENT],
  ["bad eval, bad agent", BAD_EVAL, BAD_AGENT],
  ["the agent-spec missing", GOOD_EVAL, null],
  ["the eval-spec malformed JSON", "{ not json\n", GOOD_AGENT],
];
for (const [label, e, a] of VCASES) {
  const p = specs(e, a);
  const oe = run(p, "old-eval.sh");
  const oa = run(p, "old-agent.sh");
  const nv = run(p, VALIDATE, ["arch-rater"]);
  const bothPass = oe.code === 0 && oa.code === 0;
  check(
    `validator, ${label}: the same stdout; exit 0 exactly when both old checks pass${bothPass ? "" : ", else 1 with a DEVGENIE line"}`,
    nv.out === oe.out + oa.out && (bothPass ? nv.code === 0 : nv.code === 1 && /DEVGENIE: /.test(nv.err)),
    `old ${oe.code}/${oa.code} ${JSON.stringify(oe.out + oa.out)} | new ${nv.code} ${JSON.stringify(nv.out)} ${nv.err.trim()}`,
  );
}
for (const [label, args] of [["no argument", []], ["an empty argument", [""]], ["two arguments", ["a", "b"]]]) {
  const r = run(specs(GOOD_EVAL, GOOD_AGENT), VALIDATE, args);
  check(`validator with ${label}: exit 2`, r.code === 2, `${r.code} ${r.err.trim()}`);
}
{
  const r = run(specs(GOOD_EVAL, GOOD_AGENT), VALIDATE, ["arch-rater"], { only: shimDir({}) });
  check("validator without jq on PATH: exit 1, the named refusal, no stdout", r.code === 1 && /DEVGENIE: jq is required/.test(r.err) && r.out === "", `${r.code} ${r.err.trim()}`);
}

// [3] The skills name the scripts by path; the intake skill keeps both served scripts.
console.log("\n[3] the skills name the scripts");
const skill = (s) => read(join(PLUGIN, "skills", s, "SKILL.md"));
check("scripts/step-ledger.sh exists", existsSync(STEP));
check("scripts/validate-agent-specs.sh exists", existsSync(VALIDATE));
for (const s of ["foundation", "new"]) {
  check(`skills/${s} names \${CLAUDE_PLUGIN_ROOT}/scripts/step-ledger.sh with <step> <outcome>`,
    skill(s).includes('bash "${CLAUDE_PLUGIN_ROOT}/scripts/step-ledger.sh" <step> <outcome>'));
}
check("skills/agent-foundation names ${CLAUDE_PLUGIN_ROOT}/scripts/validate-agent-specs.sh with <agent>",
  skill("agent-foundation").includes('bash "${CLAUDE_PLUGIN_ROOT}/scripts/validate-agent-specs.sh" <agent>'));
// BUG-10 (0.3.6): the served agent-scaffold and agent-slice prompts run the guard and the eval-run-log script the
// skill names, so each skill states the paths in its own text, where Claude Code substitutes ${CLAUDE_PLUGIN_ROOT}.
check("scripts/guard.sh exists", existsSync(join(PLUGIN, "scripts", "guard.sh")));
check("templates/project-metrics/record-eval-run.sh exists",
  existsSync(join(PLUGIN, "templates", "project-metrics", "record-eval-run.sh")));
check("skills/agent-scaffold names ${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh with agent-scaffold",
  skill("agent-scaffold").includes('bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-scaffold'));
check("skills/agent-slice names ${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh with agent-slice",
  skill("agent-slice").includes('bash "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" agent-slice'));
check("skills/agent-slice names ${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/record-eval-run.sh with --result verdict.json",
  skill("agent-slice").includes('bash "${CLAUDE_PLUGIN_ROOT}/templates/project-metrics/record-eval-run.sh" --result verdict.json'));
check("skills/intake keeps the two intake scripts", /the two intake scripts/.test(skill("intake")) && /Keep them/.test(skill("intake")));

// [4] Versions.
console.log("\n[4] versions");
const plugin = JSON.parse(read(join(PLUGIN, ".claude-plugin", "plugin.json")));
const market = JSON.parse(read(join(REPO, ".claude-plugin", "marketplace.json")));
check(`plugin.json version is ${VERSION}`, plugin.version === VERSION, `got ${plugin.version}`);
check(`marketplace.json devgenie version is ${VERSION}`, (market.plugins ?? []).find((p) => p.name === "devgenie")?.version === VERSION);

console.log(`\n${failures === 0 ? "COMMANDS-AS-SCRIPTS: OK" : `COMMANDS-AS-SCRIPTS: FAIL (${failures} failed)`}`);
process.exit(failures === 0 ? 0 : 1);
