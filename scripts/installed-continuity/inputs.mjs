// Pinned package inputs for the Linux installed-continuity fixture.
//
// The old side is a genuine released predecessor build, downloaded inside the
// disposable runner and verified against the digest recorded when it was first
// fetched. The new side is the candidate six-file artifact produced by the
// exact-source packaging run, verified with the same fail-closed rule.
//
// Nothing here is fetched from the developer's machine and nothing is trusted
// because a file merely exists: every comparison is against a pinned digest,
// and a mismatch throws before a package is installed.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { verifyLinuxReleaseAssets } from "../verify-linux-release-assets.mjs";

/** The released predecessor. Its package name differs from the candidate's, so
 * both are installed on the runner: the old app must produce the state that
 * the candidate then adopts, and purging one must never touch the other. */
export const OLD_PACKAGE = {
  name: "openmausbot",
  version: "0.1.83",
  asset: "OpenMausBot-0.1.83-amd64.deb",
  url: "https://github.com/milind-soni/OpenMausBot/releases/download/v0.1.83/OpenMausBot-0.1.83-amd64.deb",
  bytes: 231300320,
  sha256: "c34b4d95c26b6edb4992ec6766ebfa9e47b0a740d172ea8aec5df1d14968d017",
  installRoot: "/opt/OpenMausBot",
  executable: "/opt/OpenMausBot/openmausbot",
  serverEntry: "/opt/OpenMausBot/resources/server/index.js",
  /** 0.1.83 resolved its desktop data directory to `$HOME/.openmausbot`. */
  dataDirName: ".openmausbot",
  /** Electron derived the old `app.getPath("userData")` from the package name. */
  profileName: "openmausbot",
};

export const CANDIDATE_PACKAGE = {
  name: "crewbot",
  installRoot: "/opt/crewbot",
  executable: "/opt/crewbot/crewbot",
  serverEntry: "/opt/crewbot/resources/server/index.js",
  dataDirName: ".crewbot",
};

/** Session variables that would attach this fixture to a real desktop, a real
 * login keyring, or a real service session. A fixture that inherits any of
 * them is disqualified, not repaired. */
export const LIVE_SESSION_VARIABLES = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "WAYLAND_SOCKET",
  "XDG_SESSION_TYPE",
  "XDG_SESSION_ID",
  "XDG_SEAT",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_SYSTEM_BUS_ADDRESS",
  "GNOME_KEYRING_CONTROL",
  "SSH_AUTH_SOCK",
];

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

/** Compare one file against a pinned digest and byte count. A mismatch is a
 * hard failure: continuing would prove something about bytes nobody can name. */
export function assertPinnedFile(path, { sha256, bytes }, label = path) {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  if (typeof bytes === "number" && stat.size !== bytes) {
    throw new Error(`${label} size mismatch: ${stat.size} bytes, expected ${bytes} (${path})`);
  }
  const digest = sha256File(path);
  if (digest !== sha256) throw new Error(`${label} digest mismatch: ${digest}, expected ${sha256} (${path})`);
  return { path, bytes: stat.size, sha256: digest };
}

/** The candidate artifact is the same six files the release validator accepts.
 * Run the shared validator first, then hold every file to the pinned manifest
 * so a differently-built artifact cannot pass as the reviewed candidate. */
export function verifyCandidateArtifact(directory, manifest) {
  const root = resolve(directory);
  verifyLinuxReleaseAssets(root, manifest.version);
  const files = new Map(manifest.files.map((file) => [file.name, file]));
  const onDisk = readdirSync(root).sort();
  const expected = [...files.keys()].sort();
  if (onDisk.join(",") !== expected.join(",")) {
    throw new Error(`candidate artifact contents differ: found ${onDisk.join(", ") || "(empty)"}`);
  }
  return expected.map((name) => assertPinnedFile(join(root, name), files.get(name), `candidate ${name}`));
}

/** Refuse to run inside a session this fixture does not own. Empty values are
 * accepted because the workflow clears them the same way `ci.yml` does; a
 * value that points anywhere is a leak. */
export function assertIsolatedSessionEnv(env) {
  const leaked = LIVE_SESSION_VARIABLES.filter((key) => typeof env[key] === "string" && env[key].trim() !== "");
  if (leaked.length) {
    throw new Error(
      `this fixture owns its display, session bus and keyring; unset ${leaked.join(", ")} before running it`,
    );
  }
  return leaked;
}