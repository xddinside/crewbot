// Regressions for the candidate handover record: the one claim the packaging
// run makes about its own bytes, and the check every consumer runs before it
// installs a package.
//
// These are pure local checks over synthetic assets. They never build a package,
// never touch dpkg, a display or a keyring, and never reach GitHub. What they
// hold honest is the property the whole handoff rests on: a record minted from a
// download proves nothing, so the record and the bytes have to disagree when
// either one moves.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCandidateManifest,
  candidateArtifactName,
  candidateFileNames,
  candidateManifestArtifactName,
  CANDIDATE_MANIFEST_SCHEMA,
  parseCandidateManifest,
  verifyCandidateHandover,
  writeCandidateManifest,
} from "./linux-candidate-manifest.mjs";

const VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
const SOURCE_SHA = "1".repeat(40);
const CLI = fileURLToPath(new URL("./linux-candidate-manifest.mjs", import.meta.url));
const PRODUCER = {
  run: 12345678901,
  runAttempt: 1,
  repository: "xddinside/crewbot",
  workflow: "Package Ubuntu",
  job: "package",
  ref: "refs/pull/23/merge",
};

it("writes and verifies a producer record through the CLI and reports structured failures", () => {
  const root = scratch("cli");
  const assets = makeCandidateAssets(join(root, "assets"));
  const manifest = join(root, "manifest.json");
  const env = { ...process.env, GITHUB_RUN_ID: String(PRODUCER.run), GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: PRODUCER.repository, GITHUB_WORKFLOW: PRODUCER.workflow,
    GITHUB_JOB: PRODUCER.job, GITHUB_REF: PRODUCER.ref };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
  const written = run("write", "--assets", assets, "--out", manifest, "--source-sha", SOURCE_SHA);
  expect(written.status).toBe(0);
  expect(JSON.parse(written.stdout)).toMatchObject({ ok: true, manifestArtifactName: candidateManifestArtifactName(VERSION) });
  const args = ["check", "--assets", assets, "--manifest", manifest, "--version", VERSION];
  const checked = run(...args, "--source-sha", SOURCE_SHA);
  expect(checked.status).toBe(0);
  expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true, sourceSha: SOURCE_SHA, files: 6 });
  const missing = run(...args);
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stderr)).toMatchObject({ ok: false, error: "check needs --source-sha" });
  const wrong = run(...args, "--source-sha", "2".repeat(40));
  expect(wrong.status).toBe(1);
  expect(JSON.parse(wrong.stderr).error).toMatch(/not the expected source/);
  expect(JSON.parse(run("--help").stdout).usage).toContain("--source-sha");
});

const temporaryDirectories = [];

function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `omb-candidate-${label}-`));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

/** A candidate artifact that satisfies the shared release validator: the six
 * supported files, checksums covering exactly the package bytes, and an updater
 * feed naming the versioned AppImage and DEB.
 *
 * `repacked` seals a differently-packaged DEB — internally consistent, and
 * different from the reviewed bytes. */
function makeCandidateAssets(root, { repacked = false } = {}) {
  const appImage = `crewbot-${VERSION}-x86_64.AppImage`;
  const deb = `crewbot-${VERSION}-amd64.deb`;
  const bytes = new Map([
    [appImage, Buffer.from("synthetic AppImage bytes for the handover record")],
    [deb, Buffer.concat([
      Buffer.from("synthetic DEB bytes for the handover record"),
      ...(repacked ? [Buffer.from(" ")] : []),
    ])],
  ]);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, appImage), bytes.get(appImage));
  writeFileSync(join(root, deb), bytes.get(deb));
  writeFileSync(join(root, "crewbot.AppImage"), bytes.get(appImage));
  writeFileSync(join(root, "crewbot-amd64.deb"), bytes.get(deb));
  const packages = new Map([
    [appImage, bytes.get(appImage)],
    [deb, bytes.get(deb)],
    ["crewbot.AppImage", bytes.get(appImage)],
    ["crewbot-amd64.deb", bytes.get(deb)],
  ]);
  const sums = [...packages].map(([name, content]) => `${digest(content)}  ${name}`).join("\n");
  writeFileSync(join(root, "SHA256SUMS-ubuntu-x64.txt"), `${sums}\n`);
  writeFileSync(join(root, "latest-linux.yml"), [
    `version: ${VERSION}`,
    "files:",
    `  - url: ${appImage}`,
    `    sha512: ${sha512(bytes.get(appImage))}`,
    `    size: ${bytes.get(appImage).byteLength}`,
    `  - url: ${deb}`,
    `    sha512: ${sha512(bytes.get(deb))}`,
    `    size: ${bytes.get(deb).byteLength}`,
    `path: ${appImage}`,
    `sha512: ${sha512(bytes.get(appImage))}`,
    "",
  ].join("\n"));
  return root;
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function sha512(content) {
  return createHash("sha512").update(content).digest("base64");
}

describe("the six files a candidate is", () => {
  it("names the versioned and stable assets the release validator accepts", () => {
    expect(candidateFileNames("0.1.84")).toEqual([
      "crewbot-0.1.84-x86_64.AppImage",
      "crewbot-0.1.84-amd64.deb",
      "crewbot.AppImage",
      "crewbot-amd64.deb",
      "SHA256SUMS-ubuntu-x64.txt",
      "latest-linux.yml",
    ]);
    expect(candidateArtifactName("0.1.84")).toBe("crewbot-ubuntu-0.1.84-x64");
    // The record travels beside the package artifact, never inside it.
    expect(candidateManifestArtifactName("0.1.84")).toBe("crewbot-ubuntu-0.1.84-x64-manifest");
  });

  it("refuses a version it cannot name a set of files for", () => {
    expect(() => candidateFileNames("0.1")).toThrow(/invalid release version/);
    expect(() => candidateArtifactName("")).toThrow(/invalid release version/);
  });
});

describe("recording a packaging run", () => {
  it("captures the build source, the version, the provenance and every file's bytes", () => {
    const assets = makeCandidateAssets(scratch("record"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    expect(record.schema).toBe(CANDIDATE_MANIFEST_SCHEMA);
    expect(record.sha).toBe(SOURCE_SHA);
    expect(record.version).toBe(VERSION);
    expect(record.artifactName).toBe(candidateArtifactName(VERSION));
    expect(record.producer).toEqual(PRODUCER);
    expect(record.files.map((file) => file.name)).toEqual(candidateFileNames(VERSION));
    for (const file of record.files) {
      const content = readFileSync(join(assets, file.name));
      expect(file.bytes).toBe(content.byteLength);
      expect(file.sha256).toBe(digest(content));
    }
  });

  it("refuses to record bytes that are not the supported asset set", () => {
    const assets = makeCandidateAssets(scratch("incomplete"));
    rmSync(join(assets, "latest-linux.yml"));
    expect(() => buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER }))
      .toThrow(/missing or empty release asset: latest-linux\.yml/);
  });

  it("refuses a record without a real commit or without provenance", () => {
    const assets = makeCandidateAssets(scratch("provenance"));
    const build = (overrides) => buildCandidateManifest({
      assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER, ...overrides,
    });
    expect(() => build({ sourceSha: "7fb1e453" })).toThrow(/40 lowercase hex characters/);
    expect(() => build({ producer: { ...PRODUCER, repository: " " } })).toThrow(/producer\.repository/);
    expect(() => build({ producer: { ...PRODUCER, job: undefined } })).toThrow(/producer\.job/);
    expect(() => build({ producer: { ...PRODUCER, run: "not-a-run" } })).toThrow(/producer\.run/);
    expect(() => build({ producer: { ...PRODUCER, runAttempt: 0 } })).toThrow(/producer\.runAttempt/);
    expect(() => build({ producer: undefined })).toThrow(/producer\.run/);
  });

  it("cannot mint a record away from a GitHub run", () => {
    // The producer provenance is read from the runner's own context, so a
    // record recomputed from a download has nothing to fill these in with.
    const assets = makeCandidateAssets(scratch("offline"));
    const saved = new Map();
    for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_JOB", "GITHUB_REF"]) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    try {
      expect(() => writeCandidateManifest({ assets, out: join(assets, "handover.json"), sourceSha: SOURCE_SHA }))
        .toThrow(/producer\.(run|repository)/);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("reading a record from somewhere else", () => {
  const record = () => buildCandidateManifest({
    assets: makeCandidateAssets(scratch("parse")),
    version: VERSION,
    sourceSha: SOURCE_SHA,
    producer: PRODUCER,
  });
  const withRecord = (changes) => {
    const parsed = { ...record(), ...changes };
    if (changes?.producer) parsed.producer = { ...record().producer, ...changes.producer };
    if (changes?.files) parsed.files = changes.files(record().files);
    return parsed;
  };

  it("reads a record it produced, from text as well as from an object", () => {
    const original = record();
    expect(parseCandidateManifest(JSON.stringify(original))).toEqual(original);
    expect(parseCandidateManifest(original)).toEqual(original);
  });

  it("refuses text that is not a record at all", () => {
    expect(() => parseCandidateManifest("{not json")).toThrow(/is not JSON/);
    expect(() => parseCandidateManifest("[]")).toThrow(/is not an object/);
    expect(() => parseCandidateManifest("null")).toThrow(/is not an object/);
  });

  it("refuses a record it does not understand, field by field", () => {
    expect(() => parseCandidateManifest(withRecord({ schema: 2 }))).toThrow(/unsupported candidate handover record schema: 2/);
    expect(() => parseCandidateManifest(withRecord({ sha: "7fb1e453" }))).toThrow(/build source SHA must be 40 lowercase hex/);
    expect(() => parseCandidateManifest(withRecord({ version: "0.1" }))).toThrow(/invalid release version: 0\.1/);
    expect(() => parseCandidateManifest(withRecord({ artifactName: "crewbot-ubuntu-0.1.84-x64 (copy)" })))
      .toThrow(/not the canonical crewbot-ubuntu/);
    expect(() => parseCandidateManifest(withRecord({ producer: undefined }))).toThrow(/carries no producer provenance/);
    expect(() => parseCandidateManifest(withRecord({ producer: { workflow: " " } }))).toThrow(/producer\.workflow/);
  });

  it("refuses a record that does not cover exactly the six candidate files", () => {
    expect(() => parseCandidateManifest(withRecord({ files: (files) => files.slice(1) })))
      .toThrow(/does not cover crewbot-.*\.AppImage/);
    expect(() => parseCandidateManifest(withRecord({ files: (files) => [...files, files[0]] })))
      .toThrow(/lists crewbot-.*\.AppImage twice/);
    expect(() => parseCandidateManifest(withRecord({ files: (files) => [...files.slice(1), { name: "notes.txt", bytes: 2, sha256: digest("hi") }] })))
      .toThrow(/lists notes\.txt, which is not one of the six candidate files/);
    expect(() => parseCandidateManifest(withRecord({ files: () => "all of them" }))).toThrow(/lists no files/);
    expect(() => parseCandidateManifest(withRecord({
      files: (files) => files.map((file, index) => (index === 0 ? { ...file, bytes: 0 } : file)),
    }))).toThrow(/size for .* is not a positive whole number/);
    expect(() => parseCandidateManifest(withRecord({
      files: (files) => files.map((file, index) => (index === 0 ? { ...file, sha256: "abc" } : file)),
    }))).toThrow(/SHA-256 for .* is not a digest/);
  });
});

describe("holding downloaded bytes to the producer's record", () => {
  it("accepts the artifact the record describes and reports each verified file", () => {
    const assets = makeCandidateAssets(scratch("verified"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    const { record: parsed, files } = verifyCandidateHandover({
      manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA,
    });
    expect(parsed.sha).toBe(SOURCE_SHA);
    expect(files).toHaveLength(6);
    expect(files.map((file) => file.name)).toEqual(candidateFileNames(VERSION));
    for (const file of files) expect(file.path).toBe(join(assets, file.name));
  });

  it("compares against the caller's own source and version, never the download's", () => {
    const assets = makeCandidateAssets(scratch("expectations"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    expect(() => verifyCandidateHandover({ manifest: record, assets, version: VERSION, sourceSha: "2".repeat(40) }))
      .toThrow(/built from 1111111111111111111111111111111111111111, not the expected source 2222222222222222222222222222222222222222/);
    expect(() => verifyCandidateHandover({ manifest: record, assets, version: "9.9.9", sourceSha: SOURCE_SHA }))
      .toThrow(/missing or empty release asset: crewbot-9\.9\.9/);
    // An omitted expectation is not a pass: the record cannot supply its own.
    expect(() => verifyCandidateHandover({ manifest: record, assets }))
      .toThrow(/invalid release version/);
    expect(() => verifyCandidateHandover({ manifest: record, assets, version: VERSION }))
      .toThrow(/the expected build source SHA must be 40 lowercase hex characters/);
    expect(() => verifyCandidateHandover({ manifest: record, assets, version: VERSION, sourceSha: "" }))
      .toThrow(/the expected build source SHA must be 40 lowercase hex characters/);
  });

  it("compares against a caller-stated producer, never the ambient runner", () => {
    // Verification reads nothing from the environment: a check that consulted the
    // ambient run would reject a valid record whenever it ran somewhere else.
    const assets = makeCandidateAssets(scratch("run"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    const saved = new Map();
    for (const key of ["GITHUB_RUN_ID", "GITHUB_REPOSITORY"]) {
      saved.set(key, process.env[key]);
      process.env[key] = key === "GITHUB_RUN_ID" ? "999" : "fixture/repo";
    }
    try {
      const checked = () => verifyCandidateHandover({ manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA });
      expect(checked().files).toHaveLength(6);
      // Stated explicitly, the same check refuses a record from another run or
      // another repository.
      expect(() => verifyCandidateHandover({
        manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA,
        expectedProducer: { run: 999 },
      })).toThrow(new RegExp(`names run ${PRODUCER.run}, not this run 999`));
      expect(() => verifyCandidateHandover({
        manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA,
        expectedProducer: { repository: "someone/else" },
      })).toThrow(new RegExp(`produced in ${PRODUCER.repository}, not someone/else`));
      expect(verifyCandidateHandover({
        manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA,
        expectedProducer: { run: String(PRODUCER.run), repository: PRODUCER.repository },
      }).files).toHaveLength(6);
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("fails closed on a repack that is internally consistent", () => {
    const reviewed = makeCandidateAssets(scratch("reviewed"));
    const reviewedRecord = buildCandidateManifest({
      assets: reviewed, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER,
    });
    const repacked = makeCandidateAssets(scratch("repacked"), { repacked: true });
    expect(() => verifyCandidateHandover({
      manifest: reviewedRecord, assets: repacked, version: VERSION, sourceSha: SOURCE_SHA,
    })).toThrow(/^candidate .* mismatch: /);
  });

  it("fails closed when the record's own bytes claim disagrees with the bytes", () => {
    const assets = makeCandidateAssets(scratch("tampered"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    // A record that names a digest other than the file's own is refused even
    // though the artifact still satisfies the release validator.
    const corrupted = {
      ...record,
      files: record.files.map((file, index) => (index === 5 ? { ...file, sha256: "b".repeat(64) } : file)),
    };
    expect(() => verifyCandidateHandover({ manifest: corrupted, assets, version: VERSION, sourceSha: SOURCE_SHA }))
      .toThrow(/^candidate latest-linux\.yml digest mismatch: /);
    // So is a record whose byte count for a file no longer holds.
    const resized = {
      ...record,
      files: record.files.map((file, index) => (index === 5 ? { ...file, bytes: file.bytes + 9 } : file)),
    };
    expect(() => verifyCandidateHandover({ manifest: resized, assets, version: VERSION, sourceSha: SOURCE_SHA }))
      .toThrow(/^candidate latest-linux\.yml size mismatch: /);
  });

  it("fails closed on a seventh file, so a record cannot hide a payload beside the six", () => {
    const assets = makeCandidateAssets(scratch("extra"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    writeFileSync(join(assets, "handover.json"), JSON.stringify(record));
    expect(() => verifyCandidateHandover({ manifest: record, assets, version: VERSION, sourceSha: SOURCE_SHA }))
      .toThrow(/unexpected release assets: handover\.json/);
  });

  it("refuses a record re-derived from the download it is asked to vouch for", () => {
    // Both records describe a real six-file set and pass the release validator.
    // The repack's own record is exactly as valid as the reviewed one — which is
    // why the source SHA has to arrive from outside the artifact. A consumer
    // pinned to the reviewed commit still refuses the repack.
    const repacked = makeCandidateAssets(scratch("self-minted"), { repacked: true });
    const selfMinted = buildCandidateManifest({
      assets: repacked, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER,
    });
    expect(() => verifyCandidateHandover({
      manifest: selfMinted, assets: repacked, version: VERSION, sourceSha: "2".repeat(40),
    })).toThrow(/not the expected source 2222222222222222222222222222222222222222/);
    expect(verifyCandidateHandover({
      manifest: selfMinted, assets: repacked, version: VERSION, sourceSha: SOURCE_SHA,
    }).files).toHaveLength(6);
  });
});
describe("the command the workflows run", () => {
  const CLI = fileURLToPath(new URL("./linux-candidate-manifest.mjs", import.meta.url));

  /** Drive the real CLI the way a consumer job does, in a real child process. */
  function check({ record, assets, env = {}, omitSourceSha = false }) {
    const manifestPath = join(assets, "..", "handover.json");
    writeFileSync(manifestPath, JSON.stringify(record));
    const args = [
      CLI, "check",
      "--assets", assets,
      "--manifest", manifestPath,
      "--version", VERSION,
      ...(omitSourceSha ? [] : ["--source-sha", SOURCE_SHA]),
    ];
    const result = spawnSync(process.execPath, args, { env: { ...process.env, ...env }, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("accepts a record from this runner, naming its own run and repository", () => {
    const assets = makeCandidateAssets(scratch("cli-ok"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    const result = check({
      record, assets,
      env: { GITHUB_RUN_ID: String(PRODUCER.run), GITHUB_REPOSITORY: PRODUCER.repository },
    });
    expect(JSON.parse(result.output)).toMatchObject({ ok: true, files: 6, producer: { run: PRODUCER.run } });
    expect(result.status).toBe(0);
  });

  it("refuses a record this runner did not produce", () => {
    const assets = makeCandidateAssets(scratch("cli-wrong-run"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    const wrongRun = check({
      record, assets,
      env: { GITHUB_RUN_ID: "999", GITHUB_REPOSITORY: PRODUCER.repository },
    });
    expect(wrongRun.status).toBe(1);
    expect(wrongRun.output).toContain(`names run ${PRODUCER.run}, not this run 999`);
    const wrongRepository = check({
      record, assets,
      env: { GITHUB_RUN_ID: String(PRODUCER.run), GITHUB_REPOSITORY: "someone/else" },
    });
    expect(wrongRepository.status).toBe(1);
    expect(wrongRepository.output).toContain(`produced in ${PRODUCER.repository}, not someone/else`);
  });

  it("refuses to run without an expected source SHA", () => {
    const assets = makeCandidateAssets(scratch("cli-no-sha"));
    const record = buildCandidateManifest({ assets, version: VERSION, sourceSha: SOURCE_SHA, producer: PRODUCER });
    const result = check({ record, assets, omitSourceSha: true });
    expect(result.status).toBe(1);
    expect(result.output).toContain("check needs --source-sha");
  });
});
