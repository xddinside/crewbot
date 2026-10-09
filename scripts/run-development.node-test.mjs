import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-development.mjs", import.meta.url));
const profileUrl = new URL("../electron/profile-path.mjs", import.meta.url).href;
const configUrl = new URL("../server/config.ts", import.meta.url).href;

for (const explicit of [false, true]) {
  test(`development profile/data guard with ${explicit ? "explicit fixture roots" : "default roots in disposable home"}`, (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "crewbot-development-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const appData = path.join(dir, ".config");
    const stable = [path.join(dir, ".crewbot"), path.join(appData, "crewbot"), path.join(dir, ".cache", "crewbot")];
    for (const root of stable) {
      mkdirSync(root, { recursive: true });
      writeFileSync(path.join(root, "fixture.json"), '{"thread":"stable","credential":"synthetic-only"}');
    }
    const proxyState = path.join(dir, "portless");
    mkdirSync(proxyState);
    writeFileSync(path.join(proxyState, "proxy.port"), "1355");
    if (explicit) writeFileSync(path.join(proxyState, "proxy.tls"), "1");
    const env = {
      ...process.env,
      HOME: dir,
      USERPROFILE: dir,
      APPDATA: appData,
      XDG_CONFIG_HOME: appData,
      CREWBOT_DATA_DIR: stable[0],
      CREWBOT_PROFILE_DIR: stable[1],
      OMB_DATA_DIR: stable[0],
      OMB_PROFILE_DIR: stable[1],
      XDG_CACHE_HOME: stable[2],
      PORTLESS: "0",
      PORTLESS_PORT: "1355",
      PORTLESS_STATE_DIR: proxyState,
    };
    for (const key of ["CREWBOT_DEV_DATA_DIR", "CREWBOT_DEV_PROFILE_DIR", "CREWBOT_DEV_CACHE_DIR", "CREWBOT_DEV_PORT", "CREWBOT_DEV_WEBHOOK_PORT", "CREWBOT_DEV_START_URL"]) delete env[key];
    if (explicit) {
      env.CREWBOT_DEV_DATA_DIR = path.join(dir, "source-data");
      env.CREWBOT_DEV_PROFILE_DIR = path.join(dir, "source-profile");
      env.CREWBOT_DEV_CACHE_DIR = path.join(dir, "source-cache");
    }
    const probe = `
import { DATA_DIR } from ${JSON.stringify(configUrl)};
import { resolveDesktopProfilePath } from ${JSON.stringify(profileUrl)};
import { mkdirSync, writeFileSync } from 'node:fs';
const profile = resolveDesktopProfilePath({ appData: process.env.APPDATA, isPackaged: false });
const roots = [DATA_DIR, profile.profilePath, process.env.XDG_CACHE_HOME];
for (const root of roots) {
  mkdirSync(root, { recursive: true });
  writeFileSync(root + '/fixture.json', '{"thread":"development"}');
}
process.stdout.write(JSON.stringify({ roots, identity: profile.identityName, env: {
  data: process.env.CREWBOT_DATA_DIR, profile: process.env.CREWBOT_DEV_PROFILE_DIR,
  stableProfile: process.env.CREWBOT_PROFILE_DIR, legacyData: process.env.OMB_DATA_DIR,
  legacyProfile: process.env.OMB_PROFILE_DIR, port: process.env.CREWBOT_PORT,
  webhookPort: process.env.CREWBOT_WEBHOOK_PORT, development: process.env.CREWBOT_DEV_LAUNCH,
  portless: process.env.PORTLESS, startUrl: process.env.ELECTRON_START_URL,
}}));
`;
    const value = JSON.parse(execFileSync(process.execPath, [script, "node", "--input-type=module", "-e", probe], { cwd: dir, env, encoding: "utf8" }));
    const expected = explicit
      ? [env.CREWBOT_DEV_DATA_DIR, env.CREWBOT_DEV_PROFILE_DIR, env.CREWBOT_DEV_CACHE_DIR]
      : [path.join(dir, ".crewbot-development"), path.join(appData, "crewbot-development"), path.join(dir, ".cache", "crewbot-development")];
    assert.deepEqual(value.roots, expected);
    assert.equal(value.identity, "crewbot-development");
    assert.equal(value.env.data, expected[0]);
    assert.equal(value.env.profile, expected[1]);
    assert.equal(value.env.stableProfile, undefined);
    assert.equal(value.env.legacyProfile, undefined);
    assert.equal(value.env.legacyData, undefined);
    assert.equal(value.env.port, "18799");
    assert.equal(value.env.webhookPort, "18800");
    assert.equal(value.env.startUrl, `${explicit ? "https" : "http"}://crewbot.localhost:1355`);
    assert.equal(value.env.development, "1");
    assert.equal(value.env.portless, "1");
    for (const root of expected) rmSync(root, { recursive: true });
    for (const root of stable) {
      assert.equal(readFileSync(path.join(root, "fixture.json"), "utf8"), '{"thread":"stable","credential":"synthetic-only"}');
    }
  });
}

test("renderer launch keeps Portless routing", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /portless run --name crewbot vite/);
  assert.equal(packageJson.scripts["dev:all"], "node scripts/run-development-stack.mjs");
});
