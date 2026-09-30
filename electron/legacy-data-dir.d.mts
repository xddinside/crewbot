/** Options for moving the default data directory before app state is loaded. */
export type LegacyDataDirMigrationOptions = {
  /** The home used to decide whether `dataDir` is the default location. */
  home?: string;
  /** Candidate legacy directories in migration priority order. */
  legacyDataDirs?: string[];
  /** Refuses migration while another process may own a legacy directory. */
  assertLegacyDataDirIsNotInUse?: (legacyDataDir: string) => void;
};

/** Move a legacy workspace and rebase persisted paths with a recovery snapshot.
 *
 * @param dataDir - The selected Crewbot workspace root.
 * @param options - Optional home, legacy directories, and lease guard.
 * @returns Nothing; an unsafe or incomplete migration throws before callers read state.
 */
export function migrateLegacyDataDir(dataDir: string, options?: LegacyDataDirMigrationOptions): void;
