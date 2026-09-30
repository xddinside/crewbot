import { existsSync } from "node:fs";
import path from "node:path";

/** Resolve the Electron profile without sharing stable state with source runs.
 * Packaged upgrades continue using the old profile directory in place so the
 * operating-system encrypted credential document keeps its original identity.
 *
 * @param options - Paths and runtime identity used to select the profile.
 * @returns The selected directory and whether it belongs to an existing install.
 */
export function resolveDesktopProfilePath({ appData, isPackaged, platform = process.platform, env = process.env, exists = existsSync }) {
  const dataPath = (value) => path.resolve(value);
  if (!isPackaged) {
    const profilePath = env.CREWBOT_DEV_PROFILE_DIR?.trim() || path.join(appData, "crewbot-development");
    return { profilePath: dataPath(profilePath), legacy: false, newProfilePath: dataPath(path.join(appData, "crewbot")) };
  }

  const explicit = env.CREWBOT_PROFILE_DIR?.trim() || env.OMB_PROFILE_DIR?.trim();
  const newProfilePath = dataPath(explicit || path.join(appData, "crewbot"));
  if (explicit) return { profilePath: newProfilePath, legacy: false, newProfilePath };

  // On Linux packaged builds historically used the productName case while
  // source builds used the lower-case npm name. Keep the packaged directory
  // first if both exist; source launches now have their own explicit path.
  const legacyNames = platform === "linux" ? ["OpenMausBot", "openmausbot"] : ["openmausbot", "OpenMausBot"];
  const legacy = [...new Set(legacyNames.map((name) => dataPath(path.join(appData, name))))]
    .find((candidate) => exists(candidate));
  return {
    profilePath: legacy ?? newProfilePath,
    legacy: legacy !== undefined,
    newProfilePath,
  };
}
