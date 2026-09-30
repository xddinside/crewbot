// A bot's working folder — where its shell tools run. Validated here, once,
// so a bad path is refused at PATCH time with a reason the settings panel
// can show, rather than surfacing later as a driver spawn failure.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export type CwdValidation = { ok: true; cwd: string | null } | { ok: false; error: string };

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
  } catch {
    return { ok: false, error: `that folder doesn't exist: ${cwd}` };
  }
  if (!stat.isDirectory()) return { ok: false, error: `that path is not a folder: ${cwd}` };
  return { ok: true, cwd };
}

/** Why a turn cannot run in `cwd`, or null when the folder is usable.
 * validateBotCwd answers "may this folder be saved"; this answers "can a
 * turn start here now". A folder accepted at save time can be renamed or
 * deleted before the next turn, and the launch then fails with an ENOENT
 * that reads exactly like a CLI missing from PATH. */
export function missingCwdReason(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    return `the working folder no longer exists: ${cwd}`;
  }
  if (!stat.isDirectory()) return `the working folder is not a folder: ${cwd}`;
  return null;
}
