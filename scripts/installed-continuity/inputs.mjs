// Pinned package inputs for the Linux installed-continuity fixture.
//
// The old side is a genuine released predecessor build, downloaded inside the
// disposable runner and verified against the digest recorded when it was first
// fetched. The new side is the candidate six-file artifact this run's packaging
// job built from the exact commit under review, described by that job's own
// handover record.
//
// Nothing here is fetched from the developer's machine and nothing is trusted
// because a file merely exists: every comparison is against a pinned digest,
// and a mismatch throws before a package is installed.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyCandidateHandover } from "../linux-candidate-manifest.mjs";

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

/**
 * The candidate artifact is the same six files the release validator accepts,
 * and this run's packaging job described them in its own handover record. The
 * shared check runs the release validator first, then holds every file to that
 * record, so a repacked or repinned artifact fails closed.
 *
 * `expectedSha` is the commit this run is pinned to. It is required, and this
 * checkout's own `package.json` is a second independent witness that both the
 * record and the caller name the version actually under test.
 *
 * @param {string} directory - The directory holding exactly the six files.
 * @param {object} manifest - The producer's handover record.
 * @param {string} expectedSha - The build source SHA this run claims.
 * @returns {object[]} Each candidate file's verified path, size and digest.
 */
export function verifyCandidateArtifact(directory, manifest, expectedSha) {
  const { record, files } = verifyCandidateHandover({
    manifest,
    assets: directory,
    version: manifest?.version,
    sourceSha: expectedSha,
  });
  const checkoutVersion = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")).version;
  if (record.version !== checkoutVersion) {
    throw new Error(
      `the candidate describes version ${record.version}, but this checkout declares ${checkoutVersion}; ` +
      "the two must be the same source for the proof to mean anything",
    );
  }
  return files;
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

function repoRoot() {
  return fileURLToPath(new URL("../../", import.meta.url));
}
