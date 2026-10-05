import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { inspectLegacyDataDirServiceRecovery, recoverLegacyDataDirForService } from "../electron/legacy-data-dir.mjs";
import { LEGACY_SYSTEMD_UNIT_NAME, SYSTEMD_UNIT_NAME, servicePlan } from "./service-unit.ts";

export interface ServiceRecoveryInput {
  dataDir: string;
  platform?: NodeJS.Platform;
  home?: string;
  plan?: ReturnType<typeof servicePlan>;
  /** Injectable system command runner for isolated recovery proofs. */
  runCommand?: (command: string, args: string[]) => void;
  /**
   * Injectable probe for a unit's systemd load state. "not-found" means systemd
   * has no such unit; null means the probe itself could not answer, which the
   * recovery treats as "maybe installed" so it never skips a real stop.
   */
  unitLoadState?: (unit: string) => string | null;
}

export interface ServiceRecoveryIo {
  log(line: string): void;
  error(line: string): void;
}

function systemCommand(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "ignore" });
}

/** systemd's own view of whether a unit exists. Read-only, so it needs no sudo. */
function systemUnitLoadState(unit: string): string | null {
  try {
    const value = execFileSync("systemctl", ["show", "-p", "LoadState", "--value", unit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function isRegularFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Crewbot will not use an unsupported service unit path: ${path}`);
  return true;
}

function systemdWords(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;
  for (const char of value) {
    if (escaped) {
      if (!["\\", "'", '"', "s"].includes(char)) throw new Error(`Crewbot cannot safely parse an unsupported systemd escape in: ${value}`);
      word += char === "s" ? " " : char;
      escaped = false;
      started = true;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else word += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (escaped || quote) throw new Error(`Crewbot cannot safely parse an unfinished systemd quote or escape in: ${value}`);
  if (started) words.push(word);
  return words;
}

function unitAssignment(line: string): { name: string; value: string } | null {
  const normalized = line.trim();
  const separator = normalized.indexOf("=");
  if (separator < 0) return null;
  const name = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
  return { name, value: normalized.slice(separator + 1).trim() };
}

function serviceDataDir(unit: string, home: string): string {
  const checkedPath = (path: string): string => {
    if (!isAbsolute(path)) throw new Error(`Crewbot cannot safely roll back an old service with a non-absolute data path: ${path}`);
    return resolve(path);
  };
  const execPaths: string[] = [];
  for (const line of unit.split(/\r?\n/)) {
    const assignment = unitAssignment(line);
    if (assignment?.name !== "ExecStart") continue;
    const tokens = systemdWords(assignment.value);
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].startsWith("--data-dir=")) throw new Error("Crewbot cannot safely parse an old service using --data-dir=VALUE; restore that service manually before starting it.");
      if (tokens[index] !== "--data-dir") continue;
      if (!tokens[index + 1]) throw new Error("Crewbot found an old service --data-dir option without a value; no service was changed.");
      execPaths.push(checkedPath(tokens[index + 1]));
      index += 1;
    }
  }
  if (new Set(execPaths).size > 1) throw new Error("Crewbot found conflicting --data-dir paths in the old service commands; both data directories were preserved and no service was changed.");
  if (execPaths.length) return execPaths[execPaths.length - 1];

  const environmentValues = new Map<string, string>();
  for (const line of unit.split(/\r?\n/)) {
    const assignmentLine = unitAssignment(line);
    if (assignmentLine?.name === "EnvironmentFile") throw new Error("Crewbot cannot safely infer the old service data path from EnvironmentFile; preserve both data directories and restore the service manually.");
    if (assignmentLine?.name !== "Environment") continue;
    const assignments = systemdWords(assignmentLine.value);
    if (assignments.length === 0 || (assignments.length === 1 && assignments[0] === "")) {
      environmentValues.clear();
      continue;
    }
    for (const assignment of assignments) {
      const separator = assignment.indexOf("=");
      if (separator < 0) throw new Error(`Crewbot found an unsupported Environment assignment in the old service: ${assignment}; no service was changed.`);
      const name = assignment.slice(0, separator);
      if (name !== "CREWBOT_DATA_DIR" && name !== "OMB_DATA_DIR") continue;
      environmentValues.set(name, assignment.slice(separator + 1));
    }
  }
  const environmentPath = environmentValues.get("CREWBOT_DATA_DIR")?.trim() || environmentValues.get("OMB_DATA_DIR")?.trim();
  if (environmentPath) return checkedPath(environmentPath);
  return resolve(home, ".openmausbot");
}

/** Stop CrewBot, recover a validated pre-migration copy, then restore and start the old service. */
export function runServiceRollback(input: ServiceRecoveryInput, io: ServiceRecoveryIo): number {
  const platform = input.platform ?? process.platform;
  const home = input.home ?? homedir();
  if (platform !== "linux") {
    io.error("service rollback is available for Linux systemd cutovers only");
    return 1;
  }
  const plan = input.plan ?? servicePlan(platform, input.dataDir, home);
  if (!plan?.legacyUnit || !plan.legacyBackup) {
    io.error("service rollback could not resolve the legacy systemd unit paths");
    return 1;
  }

  const backupExists = isRegularFile(plan.legacyBackup);
  const legacyExists = isRegularFile(plan.legacyUnit);
  if (!backupExists && !legacyExists) {
    io.error(`service rollback needs the saved legacy unit at ${plan.legacyBackup} or the original unit at ${plan.legacyUnit}; no service was changed`);
    return 1;
  }
  const unitPath = backupExists ? plan.legacyBackup : plan.legacyUnit;
  const unitContents = readFileSync(unitPath, "utf8");
  if (backupExists && legacyExists && readFileSync(plan.legacyUnit, "utf8") !== unitContents) {
    io.error(`service rollback found different files at ${plan.legacyUnit} and ${plan.legacyBackup}; both units were preserved and no service was changed`);
    return 1;
  }
  let legacyDataDir: string;
  let recovery;
  try {
    legacyDataDir = serviceDataDir(unitContents, home);
    recovery = inspectLegacyDataDirServiceRecovery(input.dataDir);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (recovery && resolve(recovery.source) !== legacyDataDir) {
    io.error(`service rollback found migrated data for ${recovery.source}, while the saved legacy unit uses ${legacyDataDir}; both data directories were preserved and no service was changed`);
    return 1;
  }
  if (!recovery) {
    try {
      if (!existsSync(legacyDataDir) || !lstatSync(legacyDataDir).isDirectory() || lstatSync(legacyDataDir).isSymbolicLink()) {
        io.error(`service rollback cannot start the legacy unit because its data directory is missing or unsupported: ${legacyDataDir}; no service was changed`);
        return 1;
      }
    } catch (error) {
      io.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const run = input.runCommand ?? systemCommand;
  try {
    // A cutover that never got as far as installing crewbot.service still has
    // to be recoverable: `systemctl disable` fails outright for a unit file
    // systemd does not have, which used to abort the whole advertised recovery
    // before it republished any data. Only a confirmed "not-found" skips it; a
    // probe that cannot answer keeps the stop.
    const crewbotUnit = SYSTEMD_UNIT_NAME;
    if ((input.unitLoadState ?? systemUnitLoadState)(crewbotUnit) === "not-found") {
      io.log(`${crewbotUnit} was never installed, so there is nothing to disable; continuing the recovery`);
    } else {
      run("sudo", ["systemctl", "disable", "--now", crewbotUnit]);
    }
    if (recovery) recoverLegacyDataDirForService(input.dataDir);
    if (!legacyExists && backupExists) {
      run("sudo", ["cp", "--no-clobber", "--preserve=all", plan.legacyBackup, plan.legacyUnit]);
      if (!isRegularFile(plan.legacyUnit) || readFileSync(plan.legacyUnit, "utf8") !== unitContents) {
        throw new Error(`Crewbot could not safely restore the legacy unit at ${plan.legacyUnit}; leave both data directories intact and resolve the unit file before starting the old service.`);
      }
    }
    run("sudo", ["systemctl", "daemon-reload"]);
    run("sudo", ["systemctl", "enable", LEGACY_SYSTEMD_UNIT_NAME]);
    // `restart`, not `enable --now`. A legacy service left running by a failed
    // legacy stop still holds its database and attachment handles open on the
    // migrated tree, so `is-active` on that process would report a recovery for
    // a server that is not reading the restored root at all. Restarting makes
    // the process reopen the republished one; `restart` also starts an inactive
    // unit, so this replaces the old `enable --now` outright.
    run("sudo", ["systemctl", "restart", LEGACY_SYSTEMD_UNIT_NAME]);
    run("sudo", ["systemctl", "is-active", "--quiet", LEGACY_SYSTEMD_UNIT_NAME]);
  } catch (error) {
    io.error(`service rollback stopped before declaring the legacy service ready: ${error instanceof Error ? error.message : String(error)}. CrewBot remains disabled; preserve both data directories and resolve the reported step before continuing.`);
    return 1;
  }
  io.log(`legacy service is active with its original data directory at ${legacyDataDir}; CrewBot data remains preserved at ${resolve(input.dataDir)}`);
  return 0;
}
