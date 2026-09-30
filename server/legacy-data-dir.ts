import { homedir } from "node:os";
import { join } from "node:path";

import { assertLegacyDataDirIsNotInUse } from "./data-dir-lease.ts";
import { migrateLegacyDataDir as migrate } from "../electron/legacy-data-dir.mjs";

/** Move the default legacy workspace and rebase saved paths before loading it.
 *
 * @param dataDir - The selected Crewbot workspace root.
 * @returns Nothing. Migration and recovery failures are reported to the caller.
 */
export function migrateLegacyDataDir(dataDir: string): void {
  const home = homedir();
  migrate(dataDir, {
    home,
    legacyDataDirs: [join(home, ".openmausbot"), join(home, ".opengrokbot")],
    assertLegacyDataDirIsNotInUse,
  });
}
