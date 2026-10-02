import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyLinuxReleaseAssets } from "./verify-linux-release-assets.mjs";

const version = "1.2.3";
const appImage = `crewbot-${version}-x86_64.AppImage`;
const deb = `crewbot-${version}-amd64.deb`;

function digest(bytes, algorithm = "sha512") {
  return createHash(algorithm).update(bytes).digest(algorithm === "sha512" ? "base64" : "hex");
}

function makeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "crewbot-linux-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = new Map([
    [appImage, Buffer.from("synthetic AppImage bytes")],
    [deb, Buffer.from("synthetic DEB bytes")],
  ]);
  for (const [name, content] of bytes) writeFileSync(join(directory, name), content);
  writeFileSync(join(directory, "crewbot.AppImage"), bytes.get(appImage));
  writeFileSync(join(directory, "crewbot-amd64.deb"), bytes.get(deb));
  const feed = [
    `version: ${version}`,
    "files:",
    `  - url: ${appImage}`,
    `    sha512: ${digest(bytes.get(appImage))}`,
    `    size: ${bytes.get(appImage).byteLength}`,
    `  - url: ${deb}`,
    `    sha512: ${digest(bytes.get(deb))}`,
    `    size: ${bytes.get(deb).byteLength}`,
    `path: ${appImage}`,
    `sha512: ${digest(bytes.get(appImage))}`,
    "",
  ].join("\n");
  writeFileSync(join(directory, "latest-linux.yml"), feed);
  const checksumManifest = [
    `${digest(bytes.get(appImage), "sha256")}  ${appImage}`,
    `${digest(bytes.get(deb), "sha256")}  ${deb}`,
    `${digest(bytes.get(appImage), "sha256")}  crewbot.AppImage`,
    `${digest(bytes.get(deb), "sha256")}  crewbot-amd64.deb`,
    "",
  ].join("\n");
  writeFileSync(join(directory, "SHA256SUMS-ubuntu-x64.txt"), checksumManifest);
  return { directory, bytes };
}

function quietVerify(directory, expectedVersion = version, options) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return verifyLinuxReleaseAssets(directory, expectedVersion, options);
  } finally {
    console.log = originalLog;
  }
}

test("accepts Linux packages with matching checksums and updater feed", (t) => {
  const { directory } = makeFixture(t);
  assert.doesNotThrow(() => quietVerify(directory));
});

test("allows only the matching optional npm tarball", (t) => {
  const { directory } = makeFixture(t);
  writeFileSync(join(directory, `crewbot-${version}.tgz`), "npm tarball");
  assert.throws(() => quietVerify(directory), /unexpected release assets/);
  assert.doesNotThrow(() => quietVerify(directory, version, { allowNpm: true }));
});

test("rejects a missing supported asset", (t) => {
  const { directory } = makeFixture(t);
  rmSync(join(directory, deb));
  assert.throws(() => quietVerify(directory), /missing or empty release asset/);
});

test("rejects a feed hash that no longer matches the package bytes", (t) => {
  const { directory } = makeFixture(t);
  const changed = Buffer.from("modified AppImage bytes");
  writeFileSync(join(directory, appImage), changed);
  writeFileSync(join(directory, "crewbot.AppImage"), changed);
  const manifestPath = join(directory, "SHA256SUMS-ubuntu-x64.txt");
  const oldManifest = readFileSync(manifestPath, "utf8");
  const newHash = digest(changed, "sha256");
  writeFileSync(manifestPath, oldManifest.replace(/^[a-f0-9]{64}(?=  (?:crewbot-1\.2\.3-x86_64\.AppImage|crewbot\.AppImage)$)/gm, newHash));
  assert.throws(() => quietVerify(directory), /latest-linux\.yml hash or size mismatch/);
});

test("rejects an incorrect feed version", (t) => {
  const { directory } = makeFixture(t);
  const feedPath = join(directory, "latest-linux.yml");
  writeFileSync(feedPath, readFileSync(feedPath, "utf8").replace(`version: ${version}`, "version: 9.9.9"));
  assert.throws(() => quietVerify(directory), /version mismatch/);
});

test("rejects top-level updater metadata that disagrees with its file entries", (t) => {
  const { directory } = makeFixture(t);
  const feedPath = join(directory, "latest-linux.yml");
  writeFileSync(feedPath, readFileSync(feedPath, "utf8").replace(`path: ${appImage}`, "path: absent.AppImage"));
  assert.throws(() => quietVerify(directory), /top-level path and SHA512/);
});

test("rejects a stable package copy with different bytes", (t) => {
  const { directory } = makeFixture(t);
  writeFileSync(join(directory, "crewbot.AppImage"), "wrong stable copy");
  assert.throws(() => quietVerify(directory), /stable AppImage copy/);
});

test("rejects incorrect SHA256SUMS entries", (t) => {
  const { directory } = makeFixture(t);
  const manifestPath = join(directory, "SHA256SUMS-ubuntu-x64.txt");
  writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace(/^[a-f0-9]{64}/, "0".repeat(64)));
  assert.throws(() => quietVerify(directory), /does not exactly cover/);
});

test("rejects unsupported platform feeds", (t) => {
  const { directory } = makeFixture(t);
  writeFileSync(join(directory, "latest-mac.yml"), "parked platform feed");
  assert.throws(() => quietVerify(directory), /unexpected release assets/);
});
