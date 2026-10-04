// Consume only the native fixture's post-preflight ownership handover.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const [runnerTemp, runId, home] = process.argv.slice(2);
if (!runnerTemp || !home || !isAbsolute(runnerTemp) || !isAbsolute(home) || !/^\d+-\d+$/.test(runId ?? "")) {
  throw new Error("cleanup needs the explicit runner temp, numeric run-attempt ID and service owner's home");
}
const marker = join(runnerTemp, `omb-service-cutover-owned-${runId}.json`);
if (!existsSync(marker)) {
  console.log("the fixture never claimed ownership: no services or data will be removed");
} else {
  if (!lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()) throw new Error("refusing an unsafe ownership marker");
  const ownership = JSON.parse(readFileSync(marker, "utf8"));
  const fixtureRoot = join(runnerTemp, `omb-service-cutover-${runId}`);
  const units = ["crewbot.service", "openmausbot.service"];
  const paths = [fixtureRoot, join(home, ".openmausbot"), join(home, ".crewbot")];
  if (ownership.version !== 1 || ownership.home !== home || ownership.fixtureRoot !== fixtureRoot
    || JSON.stringify(ownership.units) !== JSON.stringify(units) || JSON.stringify(ownership.paths) !== JSON.stringify(paths)) {
    throw new Error("refusing an ownership marker that does not match this exact fixture");
  }
  const problems = [];
  const systemctl = (args, { optional = false } = {}) => {
    try {
      return execFileSync("systemctl", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (error) {
      if (!optional) problems.push(`systemctl ${args.join(" ")}: ${error.message}`);
      return null;
    }
  };
  systemctl(["disable", "--now", ...units], { optional: true });
  for (const name of [...units, "openmausbot.service.crewbot-backup"]) {
    const path = join("/etc/systemd/system", name);
    try { rmSync(path, { force: true }); } catch (error) { problems.push(`${path}: ${error.message}`); }
  }
  systemctl(["daemon-reload"]);
  systemctl(["reset-failed"], { optional: true });
  for (const path of paths) {
    try { rmSync(path, { recursive: true, force: true }); } catch (error) { problems.push(`${path}: ${error.message}`); }
  }
  for (const unit of units) {
    const state = systemctl(["show", "-p", "LoadState", "--value", unit]);
    if (state && state !== "not-found") problems.push(`owned unit survived: ${unit}=${state}`);
    const pid = Number(systemctl(["show", "-p", "MainPID", "--value", unit]));
    if (pid > 0) problems.push(`owned service process survived: ${unit} pid=${pid}`);
  }
  for (const path of paths) if (existsSync(path)) problems.push(`owned path survived: ${path}`);
  if (problems.length) throw new Error(`fixture cleanup failed:\n${problems.join("\n")}`);
  rmSync(marker);
  console.log("the fixture's recorded units and data roots are gone");
}
