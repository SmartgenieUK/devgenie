import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function inspect(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const args = process.argv.slice(2);
if (args.length !== 1 || (args[0] !== "COMPACT" && args[0] !== "CLEAR")) {
  fail("Usage: node log.mjs COMPACT or CLEAR. Supply exactly one uppercase advice word.");
}
const advice = args[0];

try {
  const directory = join(process.cwd(), ".devgenie");
  const log = join(directory, "compactor.jsonl");
  const directoryStat = inspect(directory);
  if (directoryStat && (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())) {
    fail("Cannot log advice: .devgenie must be a directory, not a link or another file type.");
  }

  const logStat = inspect(log);
  if (logStat && (logStat.isSymbolicLink() || !logStat.isFile())) {
    fail("Cannot log advice: .devgenie/compactor.jsonl must be a regular file, not a link or another file type.");
  }
  if (logStat && logStat.nlink > 1) {
    fail("Cannot log advice: .devgenie/compactor.jsonl has more than one hard link.");
  }

  if (!directoryStat) mkdirSync(directory);
  let fd;
  try {
    // Omit O_CREAT so a swapped symlink cannot create a missing outside target.
    // Known limit: someone who can already write this project and renames the log in the same instant is not stopped
    // (full closure needs O_NOFOLLOW, absent on Windows); the line written is fixed and gains them nothing.
    fd = openSync(log, logStat ? constants.O_WRONLY | constants.O_APPEND : "ax");
  } catch (error) {
    if (error.code === "EEXIST") {
      fail("Cannot log advice: .devgenie/compactor.jsonl appeared after inspection.");
    }
    throw error;
  }
  try {
    if (logStat) {
      const openedStat = fstatSync(fd);
      if (!openedStat.isFile() || openedStat.nlink !== 1
        || openedStat.dev !== logStat.dev || openedStat.ino !== logStat.ino) {
        throw new Error(".devgenie/compactor.jsonl changed after inspection.");
      }
    }
    appendFileSync(fd, JSON.stringify({ ts: new Date().toISOString(), advice }) + "\n", "utf8");
  } finally {
    closeSync(fd);
  }
} catch (error) {
  fail(`Could not append advice to the project log: ${error.message}`);
}
