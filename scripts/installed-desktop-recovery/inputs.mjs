// Pinned package inputs for the installed desktop recovery fixture.
//
// The candidate artifact is the same six files the release validator accepts,
// produced by one already-finished packaging run of the pinned source SHA. Every
// file is held to a pinned digest and byte count before anything is installed:
// a repacked or repinned artifact fails closed rather than proving something
// about bytes nobody can name.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyLinuxReleaseAssets } from "../verify-linux-release-assets.mjs";

export const CANDIDATE_PACKAGE = {
  name: "crewbot",
  installRoot: "/opt/crewbot",
  executable: "/opt/crewbot/crewbot",
  dataDirName: ".crewbot",
};

export function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

/** Compare one file against a pinned digest and byte count. A mismatch throws
 * before a package is installed. */
export function assertPinnedFile(path, pinned, label = path) {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  if (typeof pinned?.bytes === "number" && stat.size !== pinned.bytes) {
    throw new Error(`${label} size mismatch: ${stat.size} bytes, expected ${pinned.bytes} (${path})`);
  }
  const digest = sha256File(path);
  if (digest !== pinned?.sha256) {
    throw new Error(`${label} digest mismatch: ${digest}, expected ${pinned?.sha256} (${path})`);
  }
  return { path, bytes: stat.size, sha256: digest };
}

/**
 * Verify the candidate artifact this fixture is about to install.
 *
 * The shared release validator runs first, so the six files are the supported
 * set with a self-consistent `latest-linux.yml`; then the pinned manifest holds
 * each of them to the reviewed bytes. A run id or an artifact name proves
 * nothing on its own, so the manifest is the contract.
 *
 * @param options.candidateDir - The directory holding exactly the six files.
 * @param options.manifestPath - The pinned manifest JSON.
 * @param options.expectedSha - The candidate source SHA this fixture claims.
 */
export function verifyCandidateArtifact({ candidateDir, manifestPath, expectedSha }) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.sha !== expectedSha) {
    throw new Error(`candidate manifest is for ${manifest.sha}, not the claimed ${expectedSha}`);
  }
  const version = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")).version;
  try {
    verifyLinuxReleaseAssets(resolve(candidateDir), version);
  } catch (error) {
    // The candidate artifact is pinned by SHA-256, so the usual cause of this
    // failure is a checkout whose package.json has moved past the artifact.
    // Say so rather than leaving a digest-shaped complaint to be misread.
    throw new Error(
      `${error?.message ?? error} (this checkout declares version ${version}; the pinned candidate ` +
      `artifact ${manifest.artifactName} was built from ${manifest.sha})`,
    );
  }
  const pinned = new Map(manifest.files.map((file) => [file.name, file]));
  const onDisk = readdirSync(resolve(candidateDir)).sort();
  const expected = [...pinned.keys()].sort();
  if (onDisk.join(",") !== expected.join(",")) {
    throw new Error(`candidate artifact contents differ: found ${onDisk.join(", ") || "(empty)"}`);
  }
  const files = expected.map((name) => assertPinnedFile(join(resolve(candidateDir), name), pinned.get(name), `candidate ${name}`));
  return { ...manifest, version, files };
}

/** The candidate `.deb` inside a verified artifact. Both the versioned and the
 * stable name ship the same bytes; the versioned one is preferred because the
 * release validator names it. */
export function candidateDeb(files) {
  const versioned = files.find((file) => /-\d+\.\d+\.\d+-amd64\.deb$/.test(basename(file.path)));
  const chosen = versioned ?? files.find((file) => file.path.endsWith(".deb"));
  if (!chosen) throw new Error("the candidate artifact has no .deb to install");
  return chosen;
}

function repoRoot() {
  return fileURLToPath(new URL("../../", import.meta.url));
}