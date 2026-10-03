// Migration must be quiet when it works and loud when it strands data.
//
// The skip is correct by design — an existing destination wins rather than
// being clobbered — but a silent skip is indistinguishable from a successful
// migration. On an install where ~/.crewbot already exists, the skip is the
// permanent state: the old directory stays where it is, nothing points at it,
// and no error is raised. These tests pin that it now says so.
//
// Each case gets its own throwaway HOME because migrateLegacyDataDir reads
// homedir() at call time, and cases 3-5 actually rename directories — running
// them against the suite's shared home would move state other files rely on.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLegacyDataDir } from "./legacy-data-dir.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let home: string;
let realHome: string;
let errors: string[];

function makeLegacy(name: string): string {
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), "{}");
  return dir;
}

beforeEach(() => {
  realHome = homedir();
  home = mkdtempSync(join(tmpdir(), "omb-legacy-log-test-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.HOME = realHome;
  process.env.USERPROFILE = realHome;
  await removeTempDir(home);
});

describe("migrateLegacyDataDir visibility", () => {
  // The case that actually bit: destination present, legacy dir present, and
  // nothing anywhere says the old data was never picked up.
  it("warns when the destination already exists and a legacy dir is stranded", () => {
    const legacy = makeLegacy(".openmausbot");
    const destination = join(home, ".crewbot");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "current.txt"), "current workspace");

    migrateLegacyDataDir(destination);

    expect(errors.join("\n")).toContain("was not migrated");
    expect(errors.join("\n")).toContain(legacy);
    expect(errors.join("\n")).toContain("wins without merging");
    expect(errors.join("\n")).toContain("Settings > Backups");
    expect(errors.join("\n")).toContain("Keep both directories intact");
    expect(errors.join("\n")).toContain("do not delete or merge them");
    expect(errors.join("\n")).not.toMatch(/remove the destination|merge.*by hand/i);
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(join(destination, "current.txt"), "utf8")).toBe("current workspace");
  });

  it("stays quiet when there is no legacy data at all", () => {
    mkdirSync(join(home, ".crewbot"), { recursive: true });

    migrateLegacyDataDir(join(home, ".crewbot"));

    expect(errors).toEqual([]);
  });

  it("warns when a custom data dir is chosen and legacy data is left behind", () => {
    const legacy = makeLegacy(".openmausbot");
    const custom = join(home, "elsewhere");
    mkdirSync(custom);
    writeFileSync(join(custom, "current.txt"), "custom workspace");

    migrateLegacyDataDir(custom);

    expect(errors.join("\n")).toContain("custom data directory");
    expect(errors.join("\n")).toContain(legacy);
    expect(errors.join("\n")).toContain("Settings > Backups");
    expect(errors.join("\n")).toContain("do not delete or merge them");
    expect(errors.join("\n")).not.toMatch(/remove the destination|merge.*by hand/i);
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(join(custom, "current.txt"), "utf8")).toBe("custom workspace");
  });

  it("warns about a second legacy dir left behind after migrating the first", () => {
    const migrated = makeLegacy(".openmausbot");
    const stranded = makeLegacy(".opengrokbot");
    const dest = join(home, ".crewbot");

    migrateLegacyDataDir(dest);

    const warning = errors.join("\n");
    expect(warning).toContain(`${stranded} was not migrated into ${dest}`);
    expect(warning).toContain(`another legacy directory was already migrated from ${migrated}`);
    expect(warning).toContain("Settings > Backups");
    expect(warning).not.toContain(`${migrated} was not migrated`);
    expect(existsSync(stranded)).toBe(true);
  });

  // The normal upgrade path must not gain noise.
  it("migrates when an explicit data-dir path resolves to the default", () => {
    const legacy = makeLegacy(".openmausbot");
    mkdirSync(join(home, "unused"));
    const dest = join(home, "unused", "..", ".crewbot");

    migrateLegacyDataDir(dest);

    expect(errors).toEqual([]);
    expect(readFileSync(join(home, ".crewbot", "config.json"), "utf8")).toBe("{}\n");
    expect(existsSync(legacy)).toBe(false);
  });

  it("stays quiet on a clean migration", () => {
    makeLegacy(".opengrokbot");
    const dest = join(home, ".crewbot");

    migrateLegacyDataDir(dest);

    expect(errors).toEqual([]);
  });
});
