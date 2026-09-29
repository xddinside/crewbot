import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { assertLegacyDataDirIsNotInUse } from "./data-dir-lease.ts";

const LEGACY_DATA_DIR_NAMES = [".openmausbot", ".opengrokbot"];

/**
 * Move a legacy home directory into the requested default workspace, if safe.
 *
 * A custom data directory is never a migration destination. Existing
 * ~/.crewbot data wins without merging, an active legacy lease refuses the
 * move, and rename failures propagate so callers cannot continue with an
 * empty workspace while the old data remains stranded.
 *
 * @param dataDir - The requested data directory from the active entry point.
 * @returns Nothing. Filesystem or active-lease failures are thrown to the caller.
 */
export function migrateLegacyDataDir(dataDir: string): void {
  const home = homedir();
  const defaultDataDir = join(home, ".crewbot");
  if (resolve(dataDir) !== resolve(defaultDataDir) || existsSync(dataDir)) return;

  const legacyDataDir = LEGACY_DATA_DIR_NAMES
    .map((name) => join(home, name))
    .find((dir) => existsSync(dir));
  if (!legacyDataDir) return;

  assertLegacyDataDirIsNotInUse(legacyDataDir);
  renameSync(legacyDataDir, dataDir);
}
