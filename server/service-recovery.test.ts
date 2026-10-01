import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyDataDir } from "../electron/legacy-data-dir.mjs";
import { removeTempDir } from "./testing/cleanup.ts";
import { runServiceRollback } from "./service-recovery.ts";
import { servicePlan } from "./service-unit.ts";

describe("service rollback", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root); });

  it("stops Crewbot, restores legacy state and unit, then starts the legacy service", () => {
    const home = mkdtempSync(join(tmpdir(), "crewbot-service-rollback-"));
    roots.push(home);
    const source = join(home, ".openmausbot");
    const dataDir = join(home, ".crewbot");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    const savedUnit = `[Service]\nEnvironment=OMB_DATA_DIR=${source}\nExecStart=/usr/bin/node old.js serve --data-dir ${source}\n`;
    mkdirSync(source);
    mkdirSync(units);
    writeFileSync(join(source, "bots.json"), JSON.stringify([{ cwd: join(source, "workspace") }]));
    writeFileSync(legacyBackup, savedUnit);
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
      "sudo systemctl enable --now openmausbot.service",
      "sudo systemctl is-active --quiet openmausbot.service",
    ]);
    expect(JSON.parse(readFileSync(join(source, "bots.json"), "utf8"))[0].cwd).toBe(join(source, "workspace"));
    expect(JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))[0].cwd).toBe(join(dataDir, "workspace"));
    expect(existsSync(join(source, ".crewbot-migration", "recovery"))).toBe(true);
    expect(existsSync(join(dataDir, "bots.json"))).toBe(true);
    expect(out.join("\n")).toContain("legacy service is active");
    expect(err).toEqual([]);
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
    writeFileSync(legacyBackup, `Environment=OMB_DATA_DIR=${source}\n`);
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    mkdirSync(source);
    writeFileSync(join(source, "keep.txt"), "conflicting data");

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = runServiceRollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
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
    writeFileSync(legacyBackup, `Environment=OMB_DATA_DIR=${source}\n`);
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    writeFileSync(sentinel, "external sentinel");
    writeFileSync(join(dataDir, "bots.json"), "[]");
    rmSync(join(dataDir, "bots.json"));
    symlinkSync(sentinel, join(dataDir, "bots.json"));

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = runServiceRollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(readFileSync(sentinel, "utf8")).toBe("external sentinel");
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
    writeFileSync(legacyUnit, `Environment=OMB_DATA_DIR=${source}\n`);
    writeFileSync(legacyBackup, `Environment=OMB_DATA_DIR=${join(home, "other-data")}\n`);

    const calls: string[] = [];
    const err: string[] = [];
    const plan = servicePlan("linux", dataDir, home)!;
    const code = runServiceRollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
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
    const legacyDataDir = join(home, "custom-openmausbot-data");
    const units = join(home, "systemd");
    const legacyUnit = join(units, "openmausbot.service");
    const legacyBackup = `${legacyUnit}.crewbot-backup`;
    const unit = `Environment=OMB_DATA_DIR=${legacyDataDir}\n`;
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
    const code = runServiceRollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(0);
    expect(calls).toEqual([
      "systemctl disable --now crewbot.service",
      "systemctl daemon-reload",
      "systemctl enable --now openmausbot.service",
      "systemctl is-active --quiet openmausbot.service",
    ]);
    expect(readFileSync(join(legacyDataDir, "old.txt"), "utf8")).toBe("legacy workspace");
    expect(readFileSync(join(dataDir, "new.txt"), "utf8")).toBe("new workspace");
    expect(err).toEqual([]);
  });

  it("can retry after data recovery when a later systemd step fails", () => {
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
    writeFileSync(legacyBackup, `Environment=OMB_DATA_DIR=${source}\n`);
    migrateLegacyDataDir(dataDir, { home, legacyDataDirs: [source], assertLegacyDataDirIsNotInUse: () => {} });
    const plan = servicePlan("linux", dataDir, home)!;
    const messages = { log: (_line: string) => {}, error: (_line: string) => {} };
    const first = runServiceRollback({
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
    const second = runServiceRollback({
      dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup },
      runCommand: (_command, args) => calls.push(args.join(" ")),
    }, messages);
    expect(second).toBe(0);
    expect(calls).toEqual([
      "systemctl disable --now crewbot.service",
      "systemctl daemon-reload",
      "systemctl enable --now openmausbot.service",
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
    const code = runServiceRollback({ dataDir, platform: "linux", home, plan: { ...plan, legacyUnit, legacyBackup }, runCommand: (_command, args) => calls.push(args.join(" ")) }, {
      log: () => {}, error: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toMatch(/non-absolute data path/);
  });
});
