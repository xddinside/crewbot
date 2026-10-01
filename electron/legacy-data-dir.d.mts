/** Options for moving the default data directory before app state is loaded. */
export type LegacyDataDirMigrationOptions = {
  /** The home used to decide whether `dataDir` is the default location. */
  home?: string;
  /** Candidate legacy directories in migration priority order. */
  legacyDataDirs?: string[];
  /** Refuses migration while another process may own a legacy directory. */
  assertLegacyDataDirIsNotInUse?: (legacyDataDir: string) => void;
};

/** A validated migration record and paths for restoring the legacy service root. */
export type LegacyDataDirServiceRecovery =
  | {
      /** The migrated workspace kept in place during recovery. */
      readonly dataDir: string;
      /** The exact legacy workspace path recorded by the migration. */
      readonly source: string;
      /** The migration journal identifier. */
      readonly id: string;
      /** The recovery snapshot directory inside `dataDir`. */
      readonly recoveryDir: string;
      /** Supported metadata files captured before migration. */
      readonly metadataFiles: string[];
      /** New sibling path where recovery is staged before publication. */
      readonly staging: string;
      /** Absent until a previous recovery copy was published. */
      readonly alreadyRecovered?: false;
    }
  | {
      /** The migrated workspace kept in place during recovery. */
      readonly dataDir: string;
      /** The exact legacy workspace path recorded by the migration. */
      readonly source: string;
      /** The migration journal identifier. */
      readonly id: string;
      /** The recovery snapshot directory inside `dataDir`. */
      readonly recoveryDir: string;
      /** Supported metadata files captured before migration. */
      readonly metadataFiles: string[];
      /** This source path has a validated marker from an earlier completed restore. */
      readonly alreadyRecovered: true;
      /** No staging path is needed after recovery has been published. */
      readonly staging?: never;
    };

/** Result of publishing the legacy root while preserving the migrated workspace. */
export type LegacyDataDirServiceRecoveryResult = {
  /** The restored original workspace path. */
  readonly source: string;
  /** The migrated workspace that remains preserved. */
  readonly destination: string;
  /** The migration journal identifier used for this recovery. */
  readonly id: string;
};

/** Move a legacy workspace and rebase persisted paths with a recovery snapshot.
 *
 * @param dataDir - The selected Crewbot workspace root.
 * @param options - Optional home, legacy directories, and lease guard.
 * @returns Nothing; an unsafe or incomplete migration throws before callers read state.
 */
export function migrateLegacyDataDir(dataDir: string, options?: LegacyDataDirMigrationOptions): void;

/** Validate a completed default-root migration and plan service rollback recovery.
 *
 * @param dataDir - The selected migrated workspace root.
 * @returns A validated recovery plan or `null` when no completed migration exists.
 */
export function inspectLegacyDataDirServiceRecovery(dataDir: string): LegacyDataDirServiceRecovery | null;

/** Publish the exact legacy root from the migrated workspace and preserved snapshots.
 *
 * @param dataDir - The selected migrated workspace root.
 * @returns The restored source and preserved destination, or `null` when no migration exists.
 */
export function recoverLegacyDataDirForService(dataDir: string): LegacyDataDirServiceRecoveryResult | null;
