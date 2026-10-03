import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { describeCwdStatFailure, validateBotCwd } from "./bot-cwd.ts";

const dir = mkdtempSync(join(tmpdir(), "omb-cwd-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("validateBotCwd", () => {
  it("accepts an existing absolute directory", () => {
    expect(validateBotCwd(dir)).toEqual({ ok: true, cwd: dir });
  });

  it("treats null and empty as clearing the folder", () => {
    expect(validateBotCwd(null)).toEqual({ ok: true, cwd: null });
    expect(validateBotCwd("")).toEqual({ ok: true, cwd: null });
    expect(validateBotCwd("   ")).toEqual({ ok: true, cwd: null });
  });

  it("expands a leading ~ to the home folder", () => {
    // compare against homedir() itself: a Windows home like C:\Users\RUNNER~1
    // legitimately contains "~", so "no ~ in the output" is not a valid check
    expect(validateBotCwd("~")).toEqual({ ok: true, cwd: resolve(homedir()) });
  });

  it("rejects relative paths, files, and missing folders with a reason", () => {
    expect(validateBotCwd("relative/path")).toEqual({ ok: false, error: expect.stringMatching(/absolute/) });
    const file = join(dir, "a-file.txt");
    writeFileSync(file, "x");
    expect(validateBotCwd(file)).toEqual({ ok: false, error: expect.stringMatching(/not a folder/) });
    expect(validateBotCwd(join(dir, "nope"))).toEqual({ ok: false, error: expect.stringMatching(/doesn't exist/) });
    expect(validateBotCwd(42)).toEqual({ ok: false, error: expect.stringMatching(/path/) });
  });
});

describe("working-folder stat failures", () => {
  const cwd = "/workspace/project";
  const error = (code: string) => Object.assign(new Error("stat failed"), { code });

  it("distinguishes missing paths from non-folder path components", () => {
    expect(describeCwdStatFailure(error("ENOENT"), cwd, true)).toBe(`the working folder no longer exists: ${cwd}`);
    expect(describeCwdStatFailure(error("ENOTDIR"), cwd, true)).toBe(
      `the working folder path contains a component that isn't a folder: ${cwd}`,
    );
  });

  it("reports denied access and unexpected filesystem errors accurately", () => {
    expect(describeCwdStatFailure(error("EACCES"), cwd, true)).toContain("permission was denied");
    expect(describeCwdStatFailure(error("EPERM"), cwd, false)).toContain("permission was denied");
    expect(describeCwdStatFailure(error("EIO"), cwd, true)).toContain("couldn't be checked (EIO)");
    expect(describeCwdStatFailure(new Error("unexpected"), cwd, false)).toContain("couldn't be checked (I/O error)");
  });
});
