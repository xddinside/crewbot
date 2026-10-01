import { existsSync } from "node:fs";
import path from "node:path";

/** Resolve the Electron profile and the early application name it belongs to.
 * Packaged upgrades keep their old profile and safeStorage name in place so
 * operating-system encrypted credentials remain addressable. Source runs use
 * a separate profile and safeStorage name.
 *
 * @param options - Paths and runtime identity used to select the profile.
 * @returns The selected directory, safeStorage identity, and whether it is legacy.
 */
export function resolveDesktopProfilePath({ appData, isPackaged, platform = process.platform, env = process.env, exists = existsSync }) {
  const dataPath = (value) => path.resolve(value);
  if (!isPackaged) {
    const profilePath = env.CREWBOT_DEV_PROFILE_DIR?.trim() || path.join(appData, "crewbot-development");
    return {
      profilePath: dataPath(profilePath),
      legacy: false,
      identityName: "crewbot-development",
      newProfilePath: dataPath(path.join(appData, "crewbot")),
    };
  }

  const explicit = env.CREWBOT_PROFILE_DIR?.trim() || env.OMB_PROFILE_DIR?.trim();
  const newProfilePath = dataPath(explicit || path.join(appData, "crewbot"));
  if (explicit) return { profilePath: newProfilePath, legacy: false, identityName: "crewbot", newProfilePath };

  // On Linux packaged builds historically used the productName case while
  // source builds used the lower-case npm name. Keep the packaged directory
  // first if both exist; source launches now have their own explicit path.
  const legacyNames = platform === "linux" ? ["OpenMausBot", "openmausbot"] : ["openmausbot", "OpenMausBot"];
  const legacy = [...new Set(legacyNames.map((name) => dataPath(path.join(appData, name))))]
    .find((candidate) => exists(candidate));
  return {
    profilePath: legacy ?? newProfilePath,
    legacy: legacy !== undefined,
    // Electron 43 captures this name before the app emits `ready`: it uses
    // it as the macOS Keychain service/account and the Linux OSCrypt app name.
    // Keep the original packaged identity only while using an old profile.
    identityName: legacy ? "OpenMausBot" : "crewbot",
    newProfilePath,
  };
}
