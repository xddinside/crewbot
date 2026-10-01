import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { inspectLegacyDataDirServiceRecovery, recoverLegacyDataDirForService } from "../electron/legacy-data-dir.mjs";
import { servicePlan } from "./service-unit.ts";

export interface ServiceRecoveryInput {
  dataDir: string;
  platform?: NodeJS.Platform;
  home?: string;
  plan?: ReturnType<typeof servicePlan>;
  /** Injectable system command runner for isolated recovery proofs. */
  runCommand?: (command: string, args: string[]) => void;
}

export interface ServiceRecoveryIo {
  log(line: string): void;
  error(line: string): void;
}

function systemCommand(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "ignore" });
}

function isRegularFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Crewbot will not use an unsupported service unit path: ${path}`);
  return true;
}

function systemdValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\([\\"])/g, "$1")
    : trimmed.replace(/\\([\\"])/g, "$1");
}

function serviceDataDir(unit: string, home: string): string {
  const checkedPath = (value: string): string => {
    const path = systemdValue(value);
    if (!isAbsolute(path)) throw new Error(`Crewbot cannot safely roll back an old service with a non-absolute data path: ${path}`);
    return resolve(path);
  };
  const environment = unit.match(/^Environment=(?:CREWBOT_DATA_DIR|OMB_DATA_DIR)=(.*)$/m);
  if (environment) return checkedPath(environment[1]);
  const start = unit.match(/^ExecStart=(.*)$/m)?.[1];
  if (start) {
    const tokens = start.match(/"(?:\\.|[^"\\])*"|\S+/g)?.map((token) => systemdValue(token)) ?? [];
    const index = tokens.indexOf("--data-dir");
    if (index >= 0 && tokens[index + 1]) return checkedPath(tokens[index + 1]);
  }
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
    run("sudo", ["systemctl", "disable", "--now", "crewbot.service"]);
    if (recovery) recoverLegacyDataDirForService(input.dataDir);
    if (!legacyExists && backupExists) {
      run("sudo", ["cp", "--no-clobber", "--preserve=all", plan.legacyBackup, plan.legacyUnit]);
      if (!isRegularFile(plan.legacyUnit) || readFileSync(plan.legacyUnit, "utf8") !== unitContents) {
        throw new Error(`Crewbot could not safely restore the legacy unit at ${plan.legacyUnit}; leave both data directories intact and resolve the unit file before starting the old service.`);
      }
    }
    run("sudo", ["systemctl", "daemon-reload"]);
    run("sudo", ["systemctl", "enable", "--now", "openmausbot.service"]);
    run("sudo", ["systemctl", "is-active", "--quiet", "openmausbot.service"]);
  } catch (error) {
    io.error(`service rollback stopped before declaring the legacy service ready: ${error instanceof Error ? error.message : String(error)}. CrewBot remains disabled; preserve both data directories and resolve the reported step before continuing.`);
    return 1;
  }
  io.log(`legacy service is active with its original data directory at ${legacyDataDir}; CrewBot data remains preserved at ${resolve(input.dataDir)}`);
  return 0;
}
