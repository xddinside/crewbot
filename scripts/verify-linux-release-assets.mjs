import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

function fail(message) {
  throw new Error(message);
}

export function verifyLinuxReleaseAssets(directory, version, { allowNpm = false } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid release version: ${version}`);
  const root = resolve(directory);
  const appImage = `crewbot-${version}-x86_64.AppImage`;
  const deb = `crewbot-${version}-amd64.deb`;
  const expected = new Set([
    appImage,
    deb,
    "crewbot.AppImage",
    "crewbot-amd64.deb",
    "SHA256SUMS-ubuntu-x64.txt",
    "latest-linux.yml",
  ]);
  const entriesOnDisk = readdirSync(root, { withFileTypes: true });
  if (entriesOnDisk.some((entry) => !entry.isFile())) fail("release asset directory must contain regular files only");
  const files = entriesOnDisk.map((entry) => entry.name);
  if (allowNpm && files.includes(`crewbot-${version}.tgz`)) expected.add(`crewbot-${version}.tgz`);
  for (const name of expected) {
    const path = join(root, name);
    try {
      if (!statSync(path).isFile() || statSync(path).size === 0) fail(`missing or empty release asset: ${name}`);
    } catch (error) {
      if (error?.message?.startsWith("missing or empty")) throw error;
      fail(`missing or empty release asset: ${name}`);
    }
  }
  const unexpected = files.filter((name) => !expected.has(name));
  if (unexpected.length) fail(`unexpected release assets: ${unexpected.join(", ")}`);

  if (sha256(join(root, appImage)) !== sha256(join(root, "crewbot.AppImage"))) {
    fail("stable AppImage copy does not match the versioned asset");
  }
  if (sha256(join(root, deb)) !== sha256(join(root, "crewbot-amd64.deb"))) {
    fail("stable DEB copy does not match the versioned asset");
  }

  const manifest = readFileSync(join(root, "SHA256SUMS-ubuntu-x64.txt"), "utf8");
  const rows = manifest.trimEnd().split("\n").map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (\S+)$/);
    if (!match) fail("invalid SHA256SUMS-ubuntu-x64.txt row");
    return [match[2], match[1]];
  });
  const expectedChecksums = new Map([
    [appImage, sha256(join(root, appImage))],
    [deb, sha256(join(root, deb))],
    ["crewbot.AppImage", sha256(join(root, "crewbot.AppImage"))],
    ["crewbot-amd64.deb", sha256(join(root, "crewbot-amd64.deb"))],
  ]);
  if (rows.length !== expectedChecksums.size
    || new Set(rows.map(([name]) => name)).size !== expectedChecksums.size
    || rows.some(([name, hash]) => expectedChecksums.get(name) !== hash)) {
    fail("SHA256SUMS-ubuntu-x64.txt does not exactly cover the Linux package bytes");
  }

  const feed = readFileSync(join(root, "latest-linux.yml"), "utf8");
  const entries = [...feed.matchAll(/url:\s+(\S+)[\s\S]*?sha512:\s+(\S+)\n\s+size:\s+(\d+)/g)];
  const feedVersion = feed.match(/^version:\s*(\S+)\s*$/m)?.[1];
  const topLevelPath = feed.match(/^path:\s*(\S+)\s*$/m)?.[1];
  const topLevelHash = feed.match(/^sha512:\s*(\S+)\s*$/m)?.[1];
  if (feedVersion !== version) fail(`latest-linux.yml version mismatch: ${feedVersion || "missing"}`);
  const feedAssets = entries.map(([, url]) => basename(url)).sort();
  if (JSON.stringify(feedAssets) !== JSON.stringify([appImage, deb].sort())) {
    fail("latest-linux.yml must reference exactly the versioned AppImage and DEB");
  }
  for (const [, url, digest, size] of entries) {
    if (url !== basename(url)) fail(`latest-linux.yml contains a non-local asset path: ${url}`);
    const path = join(root, url);
    if (sha512(path) !== digest || statSync(path).size !== Number(size)) {
      fail(`latest-linux.yml hash or size mismatch: ${url}`);
    }
  }
  const topLevelEntry = entries.find(([, url]) => url === topLevelPath);
  if (!topLevelEntry || topLevelHash !== topLevelEntry[2]) {
    fail("latest-linux.yml top-level path and SHA512 do not match a listed asset");
  }
  if (/latest-(?:mac|win)\.yml|\bcrewbot-[^\s"']+\.(?:dmg|zip|exe)\b/.test(feed)) {
    fail("Linux updater feed advertises an unsupported platform asset");
  }
  console.log(`ok: ${version} Linux release assets, checksums, and updater feed match (${files.length} files)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, version, ...options] = process.argv.slice(2);
  if (!directory || !version || options.some((option) => option !== "--allow-npm")) {
    console.error("usage: node scripts/verify-linux-release-assets.mjs <directory> <version> [--allow-npm]");
    process.exitCode = 2;
  } else {
    try {
      verifyLinuxReleaseAssets(directory, version, { allowNpm: options.includes("--allow-npm") });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
