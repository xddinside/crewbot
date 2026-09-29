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
    mkdirSync(join(home, ".crewbot"), { recursive: true });

    migrateLegacyDataDir(join(home, ".crewbot"));

    expect(errors.join("\n")).toContain("was not migrated");
    expect(errors.join("\n")).toContain(legacy);
    expect(errors.join("\n")).toContain("wins without merging");
  });

  it("stays quiet when there is no legacy data at all", () => {
    mkdirSync(join(home, ".crewbot"), { recursive: true });

    migrateLegacyDataDir(join(home, ".crewbot"));

    expect(errors).toEqual([]);
  });

  it("warns when a custom data dir is chosen and legacy data is left behind", () => {
    const legacy = makeLegacy(".openmausbot");
    const custom = join(home, "elsewhere");

    migrateLegacyDataDir(custom);

    expect(errors.join("\n")).toContain("custom data directory");
    expect(errors.join("\n")).toContain(legacy);
  });

  it("warns about a second legacy dir left behind after migrating the first", () => {
    const first = makeLegacy(".opengrokbot");
    const second = makeLegacy(".openmausbot");
    const dest = join(home, ".crewbot");

    migrateLegacyDataDir(dest);

    expect(errors.join("\n")).toContain("left behind");
    expect(errors.join("\n")).toContain(second);
    expect(errors.join("\n")).not.toContain(first);
  });

  // The normal upgrade path must not gain noise.
  it("migrates when an explicit data-dir path resolves to the default", () => {
    const legacy = makeLegacy(".openmausbot");
    mkdirSync(join(home, "unused"));
    const dest = join(home, "unused", "..", ".crewbot");

    migrateLegacyDataDir(dest);

    expect(errors).toEqual([]);
    expect(readFileSync(join(home, ".crewbot", "config.json"), "utf8")).toBe("{}");
    expect(existsSync(legacy)).toBe(false);
  });

  it("stays quiet on a clean migration", () => {
    makeLegacy(".opengrokbot");
    const dest = join(home, ".crewbot");

    migrateLegacyDataDir(dest);

    expect(errors).toEqual([]);
  });
});
