// A bot's working folder — where its shell tools run. Validated here, once,
// so a bad path is refused at PATCH time with a reason the settings panel
// can show, rather than surfacing later as a driver spawn failure.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export type CwdValidation = { ok: true; cwd: string | null } | { ok: false; error: string };

function statFailureCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

export function describeCwdStatFailure(error: unknown, cwd: string, runtime: boolean): string {
  switch (statFailureCode(error)) {
    case "ENOENT":
      return runtime
        ? `the working folder no longer exists: ${cwd}`
        : `that folder doesn't exist: ${cwd}`;
    case "ENOTDIR":
      return runtime
        ? `the working folder path contains a component that isn't a folder: ${cwd}`
        : `a parent path component isn't a folder: ${cwd}`;
    case "EACCES":
    case "EPERM":
      return runtime
        ? `the working folder can't be accessed because permission was denied: ${cwd}`
        : `that folder can't be accessed because permission was denied: ${cwd}`;
    default: {
      const code = statFailureCode(error) ?? "I/O error";
      return runtime
        ? `the working folder couldn't be checked (${code}): ${cwd}`
        : `that folder couldn't be checked (${code}): ${cwd}`;
    }
  }
}

export function validateBotCwd(input: unknown): CwdValidation {
  if (input === null) return { ok: true, cwd: null };
  if (typeof input !== "string") return { ok: false, error: "working folder must be a path" };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, cwd: null };
  const expanded = trimmed === "~" || trimmed.startsWith("~/") ? homedir() + trimmed.slice(1) : trimmed;
  if (!isAbsolute(expanded)) return { ok: false, error: "working folder must be an absolute path" };
  const cwd = resolve(expanded);
  let stat;
  try {
    stat = statSync(cwd);
  } catch (error) {
    return { ok: false, error: describeCwdStatFailure(error, cwd, false) };
  }
  if (!stat.isDirectory()) return { ok: false, error: `that path is not a folder: ${cwd}` };
  return { ok: true, cwd };
}

/** Why a turn cannot run in `cwd`, or null when the folder is usable.
 * validateBotCwd answers "may this folder be saved"; this answers "can a
 * turn start here now". A folder accepted at save time can be renamed or
 * deleted before the next turn, or its permissions can change. Node's spawn
 * error alone cannot distinguish a missing folder from a missing CLI. */
export function missingCwdReason(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  let stat;
  try {
    stat = statSync(cwd);
  } catch (error) {
    return describeCwdStatFailure(error, cwd, true);
  }
  if (!stat.isDirectory()) return `the working folder is not a folder: ${cwd}`;
  return null;
}
