// The candidate handover record: what the packaging run built, and the proof a
// consumer needs before it installs anything.
//
// The packaging run builds the six Linux release assets, proves them with the
// shared release validator, and writes one record naming the commit it built
// from, the version, the run and job that produced the bytes, and each file's
// size and SHA-256. That record is uploaded as its own artifact, so a consumer
// receives the producer's claim and the candidate bytes as two separate inputs.
//
// The record is never recomputed from a download: a manifest derived from the
// bytes it vouches for agrees with a repack by construction. Every expectation
// below arrives from the consumer — its own checkout, its own run — never from
// the artifact it is checking.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyLinuxReleaseAssets } from "./verify-linux-release-assets.mjs";

/** Bumped when the record's shape changes, so a consumer refuses a record it
 * does not understand rather than reading fields it never checked. */
export const CANDIDATE_MANIFEST_SCHEMA = 1;

const VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
function fail(message) {
  throw new Error(message);
}

function repoRoot() {
  return fileURLToPath(new URL("../", import.meta.url));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is missing from the candidate handover record`);
  return value.trim();
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive whole number: ${String(value)}`);
  return value;
}

function requireCommit(value, label) {
  if (!COMMIT.test(value ?? "")) fail(`${label} must be 40 lowercase hex characters: ${String(value)}`);
  return value;
}

function requireVersion(value) {
  if (typeof value !== "string" || !VERSION.test(value)) fail(`invalid release version: ${String(value)}`);
  return value;
}

/**
 * The artifact name the packaging run uploads for a version.
 *
 * @param {string} version - A release version such as `0.1.84`.
 * @returns {string} The package artifact name.
 */
export function candidateArtifactName(version) {
  return `crewbot-ubuntu-${requireVersion(version)}-x64`;
}

/**
 * The artifact carrying the handover record. It is never the package artifact:
 * the record has to stay outside the six files, because the release validator
 * rejects an artifact directory holding anything else.
 *
 * @param {string} version - A release version such as `0.1.84`.
 * @returns {string} The handover-record artifact name.
 */
export function candidateManifestArtifactName(version) {
  return `${candidateArtifactName(version)}-manifest`;
}

/**
 * The exact six files a Linux candidate is.
 *
 * @param {string} version - A release version such as `0.1.84`.
 * @returns {string[]} The supported file names.
 */
export function candidateFileNames(version) {
  const pinned = requireVersion(version);
  return [
    `crewbot-${pinned}-x86_64.AppImage`,
    `crewbot-${pinned}-amd64.deb`,
    "crewbot.AppImage",
    "crewbot-amd64.deb",
    "SHA256SUMS-ubuntu-x64.txt",
    "latest-linux.yml",
  ];
}

/**
 * Record what a packaging run built, from the bytes it just validated.
 *
 * Producer side only, and only where the build happened: the provenance comes
 * from the runner's own context, so a record cannot be minted from a download.
 *
 * @param options.assets - Directory holding exactly the six release assets.
 * @param options.version - The release version those assets carry.
 * @param options.sourceSha - The commit the packaging job actually built.
 * @param options.producer - The run and job that produced the bytes.
 * @returns {object} A handover record describing the six files.
 */
export function buildCandidateManifest({ assets, version, sourceSha, producer }) {
  const root = resolve(assets);
  verifyLinuxReleaseAssets(root, requireVersion(version), { quiet: true });
  return {
    schema: CANDIDATE_MANIFEST_SCHEMA,
    sha: requireCommit(sourceSha, "the build source SHA"),
    version,
    artifactName: candidateArtifactName(version),
    producer: {
      run: requireCount(Number(producer?.run), "producer.run"),
      runAttempt: requireCount(Number(producer?.runAttempt), "producer.runAttempt"),
      repository: requireText(producer?.repository, "producer.repository"),
      workflow: requireText(producer?.workflow, "producer.workflow"),
      job: requireText(producer?.job, "producer.job"),
      ref: requireText(producer?.ref, "producer.ref"),
    },
    files: candidateFileNames(version).map((name) => ({
      name,
      bytes: statSync(join(root, name)).size,
      sha256: sha256File(join(root, name)),
    })),
  };
}

/**
 * Read every field of an untrusted record, so one that omits any of them is
 * refused rather than partially trusted.
 *
 * @param {string|object} raw - The record's JSON text, or an already-parsed object.
 * @returns {object} The normalized handover record.
 */
export function parseCandidateManifest(raw) {
  let record = raw;
  if (typeof raw === "string") {
    try {
      record = JSON.parse(raw);
    } catch (error) {
      return fail(`the candidate handover record is not JSON: ${error?.message ?? error}`);
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) fail("the candidate handover record is not an object");
  if (record.schema !== CANDIDATE_MANIFEST_SCHEMA) {
    fail(`unsupported candidate handover record schema: ${String(record.schema)}`);
  }
  const sha = requireCommit(record.sha, "the record's build source SHA");
  const version = requireVersion(record.version);
  if (record.artifactName !== candidateArtifactName(version)) {
    fail(`the record names artifact ${String(record.artifactName)}, not the canonical ${candidateArtifactName(version)}`);
  }
  const producer = record.producer;
  if (!producer || typeof producer !== "object" || Array.isArray(producer)) {
    fail("the candidate handover record carries no producer provenance");
  }
  const provenance = {
    run: requireCount(Number(producer.run), "producer.run"),
    runAttempt: requireCount(Number(producer.runAttempt), "producer.runAttempt"),
    repository: requireText(producer.repository, "producer.repository"),
    workflow: requireText(producer.workflow, "producer.workflow"),
    job: requireText(producer.job, "producer.job"),
    ref: requireText(producer.ref, "producer.ref"),
  };
  if (!Array.isArray(record.files)) fail("the candidate handover record lists no files");
  const expected = candidateFileNames(version);
  const byName = new Map();
  for (const file of record.files) {
    if (!file || typeof file !== "object" || typeof file.name !== "string") {
      fail("the candidate handover record holds an entry that is not a file record");
    }
    if (!expected.includes(file.name)) fail(`the record lists ${file.name}, which is not one of the six candidate files`);
    if (byName.has(file.name)) fail(`the record lists ${file.name} twice`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1) {
      fail(`the record's size for ${file.name} is not a positive whole number: ${String(file.bytes)}`);
    }
    if (!DIGEST.test(file.sha256 ?? "")) fail(`the record's SHA-256 for ${file.name} is not a digest: ${String(file.sha256)}`);
    byName.set(file.name, { name: file.name, bytes: file.bytes, sha256: file.sha256 });
  }
  const missing = expected.filter((name) => !byName.has(name));
  if (missing.length) fail(`the record does not cover ${missing.join(", ")}`);
  return {
    schema: CANDIDATE_MANIFEST_SCHEMA,
    sha,
    version,
    artifactName: record.artifactName,
    producer: provenance,
    files: expected.map((name) => byName.get(name)),
  };
}

/**
 * Hold downloaded candidate bytes to the producer's record.
 *
 * `version` and `sourceSha` are this consumer's own expectations — the version
 * its checkout builds and the commit it checked out — and both are required: a
 * record must not be able to supply the expectation meant to check it.
 * `expectedProducer` is optional and explicit. Pass the run and repository this
 * consumer is executing in to require that the record came from this very run;
 * nothing is read from the environment here, so the comparison is only ever as
 * strong as the expectation the caller states.
 *
 * @param options.manifest - The record, as JSON text or a parsed object.
 * @param options.assets - Directory holding exactly the six candidate files.
 * @param options.version - The version this checkout independently expects.
 * @param options.sourceSha - The build source SHA this checkout independently expects.
 * @param options.expectedProducer - Optional `{ run, repository }` this consumer independently expects.
 * @returns {{record: object, files: object[]}} The parsed record and each file's verified bytes.
 */
export function verifyCandidateHandover({ manifest, assets, version, sourceSha, expectedProducer }) {
  const root = resolve(assets);
  verifyLinuxReleaseAssets(root, requireVersion(version), { quiet: true });
  const record = parseCandidateManifest(manifest);
  if (record.version !== version) fail(`the candidate claims version ${record.version}, not the expected ${version}`);
  if (record.sha !== requireCommit(sourceSha, "the expected build source SHA")) {
    fail(`the candidate was built from ${record.sha}, not the expected source ${String(sourceSha)}`);
  }
  if (expectedProducer?.run !== undefined
    && record.producer.run !== requireCount(Number(expectedProducer.run), "the expected producer run")) {
    fail(`the candidate record names run ${record.producer.run}, not this run ${expectedProducer.run}; a handover from another run is not provable here`);
  }
  if (expectedProducer?.repository !== undefined
    && record.producer.repository !== requireText(expectedProducer.repository, "the expected producer repository")) {
    fail(`the candidate record was produced in ${record.producer.repository}, not ${expectedProducer.repository}`);
  }
  const files = record.files.map((file) => {
    const path = join(root, file.name);
    const stat = statSync(path);
    if (!stat.isFile()) fail(`candidate ${file.name} is not a regular file: ${path}`);
    if (stat.size !== file.bytes) fail(`candidate ${file.name} size mismatch: ${stat.size} bytes, expected ${file.bytes}`);
    const digest = sha256File(path);
    if (digest !== file.sha256) fail(`candidate ${file.name} digest mismatch: ${digest}, expected ${file.sha256}`);
    return { name: file.name, path, bytes: stat.size, sha256: digest };
  });
  return { record, files };
}

/**
 * Write the record for a packaging run. Provenance comes from the runner's own
 * GitHub context, so this cannot run somewhere the build did not.
 *
 * @param {string} assets - Directory holding exactly the six release assets.
 * @param {string} out - Path the JSON record is written to.
 * @param {string} sourceSha - The commit this job built.
 * @returns {object} The record that was written.
 */
export function writeCandidateManifest({ assets, out, sourceSha }) {
  const version = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")).version;
  const record = buildCandidateManifest({
    assets,
    version,
    sourceSha,
    producer: {
      run: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      repository: process.env.GITHUB_REPOSITORY,
      workflow: process.env.GITHUB_WORKFLOW,
      job: process.env.GITHUB_JOB,
      ref: process.env.GITHUB_REF,
    },
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function parseFlags(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) {
      fail(`expected --flag value pairs, found ${key ?? "(nothing)"}`);
    }
    flags.set(key.slice(2), argv[index + 1]);
  }
  return flags;
}

function required(flags, name, command) {
  const value = flags.get(name);
  if (value === undefined || value === "") fail(`${command} needs --${name}`);
  return value;
}

const USAGE = [
  "usage:",
  "  node scripts/linux-candidate-manifest.mjs write --assets <dir> --out <file> --source-sha <sha>",
  "  node scripts/linux-candidate-manifest.mjs check --assets <dir> --manifest <file> --version <v> --source-sha <sha>",
].join("\n");

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    console.log(JSON.stringify({ ok: true, usage: USAGE }));
    return;
  }
  if (command === "write") {
    const flags = parseFlags(rest);
    const record = writeCandidateManifest({
      assets: required(flags, "assets", "write"),
      out: required(flags, "out", "write"),
      sourceSha: required(flags, "source-sha", "write"),
    });
    console.log(JSON.stringify({ ok: true, sourceSha: record.sha, files: record.files.length,
      manifestArtifactName: candidateManifestArtifactName(record.version) }));
    return;
  }
  if (command === "check") {
    const flags = parseFlags(rest);
    // This runner's own run and repository, read once here at the entrypoint so
    // the check itself stays a pure function of what the caller states.
    const expectedProducer = {
      run: process.env.GITHUB_RUN_ID,
      repository: process.env.GITHUB_REPOSITORY,
    };
    const { record, files } = verifyCandidateHandover({
      manifest: readFileSync(required(flags, "manifest", "check"), "utf8"),
      assets: required(flags, "assets", "check"),
      version: required(flags, "version", "check"),
      sourceSha: required(flags, "source-sha", "check"),
      expectedProducer,
    });
    console.log(JSON.stringify({ ok: true, sourceSha: record.sha, files: files.length, producer: record.producer }));
    return;
  }
  fail(`unknown command: ${command ?? "(missing)"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action: process.argv[2] ?? null,
      error: error?.message ?? String(error), next: "Run node scripts/linux-candidate-manifest.mjs --help for valid arguments." }));
    process.exitCode = 1;
  }
}
