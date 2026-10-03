import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyDataDir } from "../electron/legacy-data-dir.mjs";
import { removeTempDir } from "./testing/cleanup.ts";
import { runServiceRollback } from "./service-recovery.ts";
import { servicePlan } from "./service-unit.ts";

function escapeSystemdBackslashes(value: string): string {
  return value.replaceAll("\\", "\\\\");
}

function quoteSystemd(value: string): string {
  return `"${escapeSystemdBackslashes(value)}"`;
}

function systemdEnvironment(name: string, value: string): string {
  return `Environment=${escapeSystemdBackslashes(`${name}=${value}`)}\n`;
}

function quotedSystemdEnvironment(name: string, value: string): string {
  return `Environment=${quoteSystemd(`${name}=${value}`)}\n`;
}

/** Rollback with an explicit "crewbot.service is installed" load state.
 *
 * Without it these tests would ask the developer's own systemd, so a machine
 * without a Crewbot service would silently take the never-installed branch.
 */
function rollback(...args: Parameters<typeof runServiceRollback>): number {
  const [input, io] = args;
  return runServiceRollback({ unitLoadState: () => "loaded", ...input }, io);
}

describe("service rollback", () => {
  const roots: string[] = [];
  // Successful publication renames a staged directory over the reserved
  // legacy root. This rollback path is Linux systemd-only; Windows rejects
  // that rename, while the lower-level publication proof runs on Linux.
  const supportsServiceDirectoryPublish = process.platform === "linux";
  afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root); });

  it.skipIf(!supportsServiceDirectoryPublish)("stops Crewbot, restores legacy state and unit, then starts the legacy service", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    const savedUnit = `[Service]\n${systemdEnvironment("OMB_DATA_DIR", source)}ExecStart=/usr/bin/node old.js serve --data-dir ${escapeSystemdBackslashes(source)}\n`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), JSON.stringify([{ cwd: join(source, "workspace") }]));
    writeFileSync(legacyBackup, savedUnit);
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });

    const plan = servicePlan("linux", dataDir, home)!;
    const calls: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const code = rollback({
      dataDir,
      platform: "linux",
      home,
      plan: { ...plan, legacyUnit, legacyBackup },
      runCommand: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (args[0] === "cp") {
          expect(readFileSync(join(source, "bots.json"), "utf8")).toContain(source);
          copyFileSync(legacyBackup, legacyUnit);
        }
        if (args.includes("is-active")) {
          expect(existsSync(source)).toBe(true);
          expect(existsSync(legacyUnit)).toBe(true);
        }
      },
    }, { log: (line) => out.push(line), error: (line) => err.push(line) });

    expect(code).toBe(0);
    expect(calls).toEqual([
      "sudo systemctl disable --now crewbot.service",
      `sudo cp --no-clobber --preserve=all ${legacyBackup} ${legacyUnit}`,
      "sudo systemctl daemon-reload",
      "sudo systemctl enable openmausbot.service",
      "sudo systemctl restart openmausbot.service",
      "sudo systemctl is-active --quiet openmausbot.service",
    ]);
    expect(JSON.parse(readFileSync(join(source, "bots.json"), "utf8"))[0].cwd).toBe(join(source, "workspace"));
    expect(JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))[0].cwd).toBe(join(dataDir, "workspace"));
    expect(existsSync(join(source, ".crewbot-migration", "recovery"))).toBe(true);
    expect(existsSync(join(dataDir, "bots.json"))).toBe(true);
    expect(out.join("\n")).toContain("legacy service is active");
    expect(err).toEqual([]);
  });

  it.skipIf(!supportsServiceDirectoryPublish)("recovers the legacy root when Crewbot's unit was never installed", () => {
    // A cutover that never reached activation has no crewbot.service for
    // systemd to disable, and `systemctl disable` fails outright for a unit
    // file systemd does not have. The advertised recovery still has to publish
    // the legacy root and start the legacy service.
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-uninstalled-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), JSON.stringify([{ cwd: join(source, "workspace") }]));
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", source));
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });

    const plan = servicePlan("linux", dataDir, home)!;
    const calls: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const code = runServiceRollback({
      dataDir,
      platform: "linux",
      home,
      plan: { ...plan, legacyUnit, legacyBackup },
      unitLoadState: (unit) => (unit === "crewbot.service" ? "not-found" : "loaded"),
      runCommand: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (args[0] === "cp") copyFileSync(legacyBackup, legacyUnit);
      },
    }, { log: (line) => out.push(line), error: (line) => err.push(line) });

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(calls).toEqual([
      `sudo cp --no-clobber --preserve=all ${legacyBackup} ${legacyUnit}`,
      "sudo systemctl daemon-reload",
      "sudo systemctl enable openmausbot.service",
      "sudo systemctl restart openmausbot.service",
      "sudo systemctl is-active --quiet openmausbot.service",
    ]);
    expect(calls.some((call) => call.includes("disable"))).toBe(false);
    expect(out.join("\n")).toContain("crewbot.service was never installed");
    expect(JSON.parse(readFileSync(join(source, "bots.json"), "utf8"))[0].cwd).toBe(join(source, "workspace"));
    expect(existsSync(join(dataDir, "bots.json"))).toBe(true);
  });

  it("still tries to stop Crewbot when systemd's load state cannot be read", () => {
    // A probe that cannot answer must not be read as "not installed": the stop
    // is the one step that protects the data root from a running writer.
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-unknown-"));
    roots.push(home);
    const dataDir = join(home, "custom-data");
    const legacyDataDir = join(home, "custom openmausbot data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(legacyDataDir);
    mkdirSync(units);
    writeFileSync(legacyUnit, quotedSystemdEnvironment("OMB_DATA_DIR", legacyDataDir));
    writeFileSync(legacyBackup, quotedSystemdEnvironment("OMB_DATA_DIR", legacyDataDir));

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = runServiceRollback({
      dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup },
      unitLoadState: () => null,
      runCommand: (_command, args) => calls.push(args.join(" ")),
    }, { log: () => {}, error: (line) => err.push(line) });

    expect(code).toBe(0);
    expect(calls).toEqual([
      "systemctl disable --now crewbot.service",
      "systemctl daemon-reload",
      "systemctl enable openmausbot.service",
      "systemctl restart openmausbot.service",
      "systemctl is-active --quiet openmausbot.service",
    ]);
    expect(err).toEqual([]);
  });

  it("restarts the legacy service instead of leaving a running one on the migrated tree", () => {
    // A legacy stop that failed leaves the old process alive with its database
    // and attachment handles open on the migrated tree. `enable --now` would
    // then report `is-active` for a server that is not reading the root this
    // recovery just republished, so the sequence has to restart it.
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-restart-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const legacyDataDir = join(home, "legacy data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    const unit = `${quotedSystemdEnvironment("OMB_DATA_DIR", legacyDataDir)}\n`;
    mkdirSync(dataDir);
    mkdirSync(legacyDataDir);
    mkdirSync(units);
    writeFileSync(join(legacyDataDir, "old.txt"), "legacy workspace");
    writeFileSync(legacyUnit, unit);
    writeFileSync(legacyBackup, unit);

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({
      dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup },
      runCommand: (_command, args) => calls.push(args.join(" ")),
    }, { log: () => {}, error: (line) => err.push(line) });

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(calls.some((call) => call === "systemctl restart openmausbot.service")).toBe(true);
    expect(calls.some((call) => call.includes("enable --now openmausbot.service"))).toBe(false);
    expect(readFileSync(join(legacyDataDir, "old.txt"), "utf8")).toBe("legacy workspace");
  });

  it("refuses a conflicting original path before stopping Crewbot", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-conflict-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), "[]");
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", source));
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    mkdirSync(source);
    writeFileSync(join(source, "keep.txt"), "conflicting data");

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(readFileSync(join(source, "keep.txt"), "utf8")).toBe("conflicting data");
    expect(err.join("\n")).toMatch(/will not replace the existing legacy data directory/i);
  });

  it("refuses a symlinked metadata entry before stopping Crewbot or changing its external target", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-symlink-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const sentinel = join(home, "external-sentinel.json");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), "[]");
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", source));
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    writeFileSync(sentinel, "external sentinel");
    writeFileSync(join(dataDir, "bots.json"), "[]");
    rmSync(join(dataDir, "bots.json"));
    symlinkSync(sentinel, join(dataDir, "bots.json"));

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(readFileSync(sentinel, "utf8")).toBe("external sentinel");
    expect(err.join("\n")).toMatch(/symbolic link in migrated metadata/i);
  });

  it("refuses a dangling metadata link before stopping Crewbot or creating the target", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-dangling-link-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const missingTarget = join(home, "missing-external-metadata.json");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), "[]");
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", source));
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    rmSync(join(dataDir, "bots.json"));
    symlinkSync(missingTarget, join(dataDir, "bots.json"));

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(existsSync(missingTarget)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(err.join("\n")).toMatch(/symbolic link in migrated metadata/i);
  });

  it("does not replace an existing legacy unit with a different backup", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-unit-conflict-"));
    roots.push(home);
    const dataDir = join(home, "custom-data");
    const source = join(home, "custom-legacy-data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(legacyUnit, systemdEnvironment("OMB_DATA_DIR", source));
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", join(home, "other-data")));

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toMatch(/different files/);
  });

  it("keeps a custom legacy data path and the selected custom workspace intact", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-custom-rollback-"));
    roots.push(home);
    const dataDir = join(home, "custom-crewbot-data");
    const legacyDataDir = join(home, "custom openmausbot data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    const unusedLegacyDataDir = join(home, "unused openmausbot data");
    const escapedLegacyDataDir = escapeSystemdBackslashes(legacyDataDir).replaceAll(" ", "\\s");
    const unit = `${quotedSystemdEnvironment("OMB_DATA_DIR", unusedLegacyDataDir)}${quotedSystemdEnvironment("CREWBOT_DATA_DIR", unusedLegacyDataDir)}Environment=CREWBOT_DATA_DIR=${escapedLegacyDataDir}\n`;
    mkdirSync(dataDir);
    mkdirSync(legacyDataDir);
    mkdirSync(units);
    writeFileSync(join(dataDir, "new.txt"), "new workspace");
    writeFileSync(join(legacyDataDir, "old.txt"), "legacy workspace");
    writeFileSync(legacyUnit, unit);
    writeFileSync(legacyBackup, unit);

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      "systemctl disable --now crewbot.service",
      "systemctl daemon-reload",
      "systemctl enable openmausbot.service",
      "systemctl restart openmausbot.service",
      "systemctl is-active --quiet openmausbot.service",
    ]);
    expect(readFileSync(join(legacyDataDir, "old.txt"), "utf8")).toBe("legacy workspace");
    expect(readFileSync(join(dataDir, "new.txt"), "utf8")).toBe("new workspace");
    expect(err).toEqual([]);
  });

  it.skipIf(!supportsServiceDirectoryPublish)("can retry after data recovery when a later systemd step fails", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-retry-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), JSON.stringify([{ cwd: join(source, "workspace") }]));
    writeFileSync(legacyBackup, systemdEnvironment("OMB_DATA_DIR", source));
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    const plan = servicePlan("linux", dataDir, home)!;
    const messages = { log: (_line: string) => {}, error: (_line: string) => {} };
    const first = rollback({
      dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup },
      runCommand: (_command, args) => {
        if (args.includes("daemon-reload")) throw new Error("synthetic daemon-reload failure");
        if (args[0] === "cp") copyFileSync(legacyBackup, legacyUnit);
      },
    }, messages);
    expect(first).toBe(1);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(source, ".crewbot-migration", "recovery"))).toBe(true);

    const calls: string[] = [];
    const second = rollback({
      dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup },
      runCommand: (_command, args) => calls.push(args.join(" ")),
    }, messages);
    expect(second).toBe(0);
    expect(calls).toEqual([
      "systemctl disable --now crewbot.service",
      "systemctl daemon-reload",
      "systemctl enable openmausbot.service",
      "systemctl restart openmausbot.service",
      "systemctl is-active --quiet openmausbot.service",
    ]);
    expect(JSON.parse(readFileSync(join(source, "bots.json"), "utf8"))[0].cwd).toBe(join(source, "workspace"));
    expect(JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))[0].cwd).toBe(join(dataDir, "workspace"));
  });

  it("refuses an unsupported relative data path before changing services", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-relative-path-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(units);
    writeFileSync(legacyBackup, "Environment=OMB_DATA_DIR=relative/old-data\n");

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toMatch(/non-absolute data path/);
  });

  it("refuses malformed quoted data path assignments instead of falling back to the default", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-malformed-environment-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const defaultLegacyDataDir = join(home, ".openmausbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(defaultLegacyDataDir);
    mkdirSync(units);
    writeFileSync(join(defaultLegacyDataDir, "old.txt"), "keep old data");
    writeFileSync(legacyBackup, 'Environment="CREWBOT_DATA_DIR=/custom data\n');

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(readFileSync(join(defaultLegacyDataDir, "old.txt"), "utf8")).toBe("keep old data");
    expect(err.join("\n")).toMatch(/unfinished systemd quote or escape/);
  });

  it("applies empty Environment resets and assignments written after the reset", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-environment-reset-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const defaultDataDir = join(home, ".openmausbot");
    const previousDataDir = join(home, "previous custom data");
    const postResetDataDir = join(home, "post reset custom data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(defaultDataDir);
    mkdirSync(previousDataDir);
    mkdirSync(postResetDataDir);
    mkdirSync(units);

    const runUnit = (unit: string): { code: number; out: string[]; err: string[] } => {
      writeFileSync(legacyBackup, unit);
      writeFileSync(legacyUnit, unit);
      const out: string[] = [];
      const err: string[] = [];
      const plan = servicePlan("linux", dataDir, home)!;
      const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: () => {} }, {
        log: (line) => out.push(line), error: (line) => err.push(line),
      });
      return { code, out, err };
    };

    const resetToDefault = runUnit(`${quotedSystemdEnvironment("OMB_DATA_DIR", previousDataDir)}Environment=\n`);
    expect(resetToDefault.code).toBe(0);
    expect(resetToDefault.out.join("\n")).toContain(defaultDataDir);
    expect(resetToDefault.err).toEqual([]);

    const assignmentAfterReset = runUnit(`${quotedSystemdEnvironment("OMB_DATA_DIR", previousDataDir)}Environment=\n${quotedSystemdEnvironment("OMB_DATA_DIR", postResetDataDir)}`);
    expect(assignmentAfterReset.code).toBe(0);
    expect(assignmentAfterReset.out.join("\n")).toContain(postResetDataDir);
    expect(assignmentAfterReset.err).toEqual([]);
  });

  it("parses indented directives with spacing around equals and preserves quoted custom roots", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-directive-whitespace-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const customDataDir = join(home, "custom data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(customDataDir);
    mkdirSync(units);
    writeFileSync(legacyBackup, `  Environment = ${quoteSystemd(`OMB_DATA_DIR=${customDataDir}`)}  \n`);

    const logs: string[] = [];
    const errors: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => {
      if (args[0] === "cp") copyFileSync(legacyBackup, legacyUnit);
    } }, {
      log: (line) => logs.push(line), error: (line) => errors.push(line),
    });

    expect(code, errors.join("\n")).toBe(0);
    expect(logs.join("\n")).toContain(customDataDir);
    expect(errors).toEqual([]);
  });

  it("refuses a spaced EnvironmentFile directive before changing services", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-environment-file-spacing-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const defaultDataDir = join(home, ".openmausbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(defaultDataDir);
    mkdirSync(units);
    writeFileSync(legacyBackup, `  EnvironmentFile = ${quoteSystemd(join(home, "old.env"))}\n`);

    const calls: string[] = [];
    const errors: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => errors.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join("\n")).toMatch(/EnvironmentFile/);
  });

  it("recognizes a spaced ExecStart directive and quoted data-dir argument", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-execstart-spacing-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const customDataDir = join(home, "custom data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(customDataDir);
    mkdirSync(units);
    writeFileSync(legacyBackup, `  ExecStart = /usr/bin/node old.js serve --data-dir ${quoteSystemd(customDataDir)}\n`);

    const logs: string[] = [];
    const errors: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => {
      if (args[0] === "cp") copyFileSync(legacyBackup, legacyUnit);
    } }, {
      log: (line) => logs.push(line), error: (line) => errors.push(line),
    });

    expect(code, errors.join("\n")).toBe(0);
    expect(logs.join("\n")).toContain(customDataDir);
    expect(errors).toEqual([]);
  });

  it("refuses an ambiguous unquoted data path with spaces before changing services", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-ambiguous-environment-"));
    roots.push(home);
    const dataDir = join(home, "new-data");
    const defaultLegacyDataDir = join(home, ".openmausbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    mkdirSync(dataDir);
    mkdirSync(defaultLegacyDataDir);
    mkdirSync(units);
    writeFileSync(join(defaultLegacyDataDir, "old.txt"), "keep old data");
    writeFileSync(legacyBackup, `Environment=CREWBOT_DATA_DIR=${escapeSystemdBackslashes(join(home, "custom data"))}\n`);

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = rollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(readFileSync(join(defaultLegacyDataDir, "old.txt"), "utf8")).toBe("keep old data");
    expect(err.join("\n")).toMatch(/unsupported Environment assignment/);
  });
});
