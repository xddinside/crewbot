// Pinned package inputs for the installed desktop recovery fixture.
//
// The candidate artifact is the same six files the release validator accepts,
// built by this run's packaging job from the exact commit under review and
// described by that job's own handover record. Every file is held to the
// record's size and SHA-256 before anything is installed: a repacked artifact
// fails closed rather than proving something about bytes nobody can name.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCandidateManifest, verifyCandidateHandover } from "../linux-candidate-manifest.mjs";

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
 * The handover record is read first and has to carry its producer provenance,
 * the schema it claims, and the source SHA this run was pinned to — a record
 * that does not is refused rather than partially believed. Then the shared
 * check runs the release validator on the six files and holds each of them to
 * the record's size and digest. The record is never rebuilt from the download:
 * one derived from the bytes it vouches for would agree with a repack by
 * construction.
 *
 * @param options.candidateDir - The directory holding exactly the six files.
 * @param options.manifestPath - The producer's handover record JSON.
 * @param options.expectedSha - The candidate source SHA this fixture claims.
 */
export function verifyCandidateArtifact({ candidateDir, manifestPath, expectedSha }) {
  const record = parseCandidateManifest(readFileSync(manifestPath, "utf8"));
  if (record.sha !== expectedSha) {
    throw new Error(`candidate manifest is for ${record.sha}, not the claimed ${expectedSha}`);
  }
  const version = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")).version;
  let files;
  try {
    ({ files } = verifyCandidateHandover({
      manifest: record,
      assets: candidateDir,
      version,
      sourceSha: expectedSha,
    }));
  } catch (error) {
    // The candidate artifact is held to this checkout's source, so the usual
    // cause of this failure is a checkout whose package.json has moved past the
    // artifact. Say so rather than leaving a digest-shaped complaint to be
    // misread.
    throw new Error(
      `${error?.message ?? error} (this checkout declares version ${version}; the candidate ` +
      `artifact ${record.artifactName} was built from ${record.sha})`,
    );
  }
  return { ...record, version, files };
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