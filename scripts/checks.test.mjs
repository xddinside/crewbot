import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CHECKS, parseArguments, runCheck, selectChecks } from "./checks.mjs";

const scratch = mkdtempSync(join(tmpdir(), "omb-checks-run-check-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

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
describe("checks.mjs missing executable", () => {
  it("settles once and survives the error/close pair a spawn failure emits", async () => {
    // A real spawn of a path that does not exist: both `error` and `close` fire.
    // Settling twice closed the log descriptor again and threw EBADF out of the
    // event handler, killing the battery instead of reporting one bad command.
    const missing = join(scratch, "no-such-check-binary");
    const result = await runCheck({ name: "ghost", command: [missing, "--run"] }, join(scratch, "ghost.log"));

    expect(result.exitCode).toBe(127);
    expect(result.error).toMatch(/ENOENT/);
    expect(result.command).toBe(`${missing} --run`);
    // The descriptor is closed once; a second close would throw here.
    expect(() => readFileSync(result.logPath, "utf8")).not.toThrow();
  });

  it("runs a real command through the same seam and closes its log", async () => {
    const result = await runCheck(
      { name: "inline", command: [process.execPath, "-e", "process.stdout.write('hello from the check\\n')"] },
      join(scratch, "inline.log"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(readFileSync(result.logPath, "utf8")).toContain("hello from the check");
  });

  it("reports a command that fails without losing its log", async () => {
    const result = await runCheck(
      { name: "failing", command: [process.execPath, "-e", "process.stderr.write('boom\\n'); process.exit(2)"] },
      join(scratch, "failing.log"),
    );

    expect(result.exitCode).toBe(2);
    expect(readFileSync(result.logPath, "utf8")).toContain("boom");
  });
});
