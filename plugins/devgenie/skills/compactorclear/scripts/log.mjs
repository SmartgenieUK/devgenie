// Records one compact-or-clear advice word through the shared local-records library (.devgenie/events.jsonl).
// Nothing is enforced by this logger, so a recording problem never blocks the developer (exit 0); it is never silent either:
// every failed write prints a plain message. Only a wrong argument exits 1, because nothing was asked to be recorded.
const args = process.argv.slice(2);
if (args.length !== 1 || (args[0] !== "COMPACT" && args[0] !== "CLEAR")) {
  console.error("Usage: node log.mjs COMPACT or CLEAR. Supply exactly one uppercase advice word.");
  process.exit(1);
}
const advice = args[0];

let appendEvent;
try {
  ({ appendEvent } = await import(new URL("../../../scripts/local-records.mjs", import.meta.url).href));
} catch (_error) {
  console.error("Advice was not recorded: the DevGenie records library could not be loaded. Reinstall the DevGenie plugin.");
  process.exit(0);
}

try {
  const result = appendEvent(process.cwd(), { component: "compactor", kind: "advice", data: { advice } });
  if (!result.ok) {
    console.error("Advice was not recorded: " + result.message);
    process.exit(0); // rule: fail-open-record
  }
} catch (error) {
  console.error("Advice was not recorded: " + error.message);
  process.exit(0);
}
