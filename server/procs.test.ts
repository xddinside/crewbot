import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertSafeCliArgv,
  describeSpawnFailure,
  estimatedWindowsCommandLineChars,
  WINDOWS_SAFE_COMMAND_LINE_CHARS,
} from "./procs.ts";

describe("Windows CLI argument safety", () => {
  it("accepts ordinary launches", () => {
    const resolved = { command: "agy.exe", args: ["--model", "gemini-3.1-pro-high"] };
    expect(estimatedWindowsCommandLineChars(resolved)).toBeLessThan(WINDOWS_SAFE_COMMAND_LINE_CHARS);
    expect(() => assertSafeCliArgv(resolved, "win32")).not.toThrow();
  });

  it("rejects a prompt-sized argv before CreateProcess can fail opaquely", () => {
    const resolved = { command: "agy.exe", args: ["--print", "x".repeat(40_000)] };
    expect(() => assertSafeCliArgv(resolved, "win32")).toThrow(
      /pass large prompts through stdin or a file/,
    );
    try {
      assertSafeCliArgv(resolved, "win32");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENAMETOOLONG");
    }
  });

  it("does not impose the Windows limit on other platforms", () => {
    const resolved = { command: "agy", args: ["--print", "x".repeat(40_000)] };
    expect(() => assertSafeCliArgv(resolved, "linux")).not.toThrow();
  });

  it("turns ENAMETOOLONG into an actionable message without echoing argv", () => {
    const error = Object.assign(new Error("private prompt contents"), { code: "ENAMETOOLONG" });
    const failure = describeSpawnFailure(error, "agy");
    expect(failure).toEqual({
      message: "`agy` received too much launch data for Windows; update this provider or pass its prompt through stdin/a file",
      setup: false,
    });
    expect(failure.message).not.toContain("private prompt contents");
  });
});

// Node reports a missing executable and a missing working folder as the same
// ENOENT, so the wording has to be decided from the folder, not the errno.
describe("spawn failures that name a working folder", () => {
  const enoent = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" });

  it("blames the deleted folder instead of the CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "crewbot-deleted-cwd-"));
    rmSync(cwd, { recursive: true });
    const failure = describeSpawnFailure(enoent, "opencode", cwd);
    expect(failure.message).toBe(`the working folder no longer exists: ${cwd}`);
    expect(failure.message).not.toContain("opencode");
    expect(failure.setup).toBe(false);
  });

  it("still reports a missing CLI when the folder is fine", () => {
    const failure = describeSpawnFailure(enoent, "opencode", tmpdir());
    expect(failure.message).toBe("`opencode` isn't installed, or isn't on this app's PATH");
    expect(failure.setup).toBe(true);
  });

  it("keeps the folder wording when no folder was pinned", () => {
    expect(describeSpawnFailure(enoent, "opencode").message).toContain("isn't installed");
    expect(describeSpawnFailure(enoent, "opencode", null).message).toContain("isn't installed");
  });

  it("names the folder when the path is a file, not a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "crewbot-cwd-"));
    const file = join(dir, "not-a-folder");
    writeFileSync(file, "");
    try {
      const notdir = Object.assign(new Error("spawn opencode ENOTDIR"), { code: "ENOTDIR" });
      expect(describeSpawnFailure(notdir, "opencode", file).message).toBe(
        `the working folder is not a folder: ${file}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
