import { describe, expect, it } from "vitest";

import { CHECKS, parseArguments, selectChecks } from "./checks.mjs";

describe("checks.mjs arguments", () => {
  it("runs the whole battery by default", () => {
    const options = parseArguments([]);
    expect(options.only).toEqual([]);
    expect(options.keepGoing).toBe(false);
    expect(selectChecks(CHECKS, options.only)).toEqual(CHECKS);
  });

  it("takes a subset as names or as one comma-separated value", () => {
    expect(selectChecks(CHECKS, parseArguments(["--only", "lint,i18n"]).only).map((check) => check.name)).toEqual(["lint", "i18n"]);
    expect(selectChecks(CHECKS, parseArguments(["--only", "lint", "--only", "electron"]).only).map((check) => check.name)).toEqual(["lint", "electron"]);
  });

  it("covers CI's static job in CI's order and leaves the suite to CI", () => {
    expect(CHECKS.map((check) => check.name)).toEqual(["typecheck", "lint", "i18n", "electron"]);
    for (const check of CHECKS) expect(check.command.join(" ")).not.toContain("test");
  });

  it("rejects an unknown check by name rather than running nothing", () => {
    expect(() => selectChecks(CHECKS, ["typecheck", "tests"])).toThrow(/unknown check\(s\): tests/);
  });

  it("rejects a flag with no value and a flag it does not know", () => {
    expect(() => parseArguments(["--only"])).toThrow(/--only needs a value/);
    expect(() => parseArguments(["--json"])).toThrow(/--json needs a value/);
    expect(() => parseArguments(["--verbose"])).toThrow(/unknown argument: --verbose/);
  });
});