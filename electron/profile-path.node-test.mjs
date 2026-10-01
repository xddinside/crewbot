import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { resolveDesktopProfilePath } from "./profile-path.mjs";

const appData = path.join(tmpdir(), "crewbot-profile-path-test");

test("source launches use a dedicated profile even when a stable profile override is inherited", () => {
  const result = resolveDesktopProfilePath({
    appData,
    isPackaged: false,
    platform: "linux",
    env: { CREWBOT_PROFILE_DIR: path.join(appData, "crewbot") },
    exists: () => true,
  });
  assert.equal(result.profilePath, path.join(appData, "crewbot-development"));
  assert.equal(result.legacy, false);
  assert.equal(result.identityName, "crewbot-development");
});

test("packaged upgrades keep the OpenMausBot profile and original package-name identity", () => {
  const result = resolveDesktopProfilePath({
    appData,
    isPackaged: true,
    platform: "linux",
    env: {},
    exists: (candidate) => candidate === path.join(appData, "OpenMausBot"),
  });
  assert.equal(result.profilePath, path.join(appData, "OpenMausBot"));
  assert.equal(result.legacy, true);
  assert.equal(result.identityName, "openmausbot");
  assert.equal(result.newProfilePath, path.join(appData, "crewbot"));
});

test("macOS packaged upgrades keep the original package-name Keychain identity", () => {
  const result = resolveDesktopProfilePath({
    appData,
    isPackaged: true,
    platform: "darwin",
    env: {},
    exists: (candidate) => candidate === path.join(appData, "OpenMausBot"),
  });
  assert.equal(result.profilePath, path.join(appData, "OpenMausBot"));
  assert.equal(result.identityName, "openmausbot");
  assert.equal(result.legacy, true);
});

test("new installs and explicit stable profile paths remain deliberate", () => {
  const fresh = resolveDesktopProfilePath({ appData, isPackaged: true, env: {}, exists: () => false });
  assert.equal(fresh.profilePath, path.join(appData, "crewbot"));
  assert.equal(fresh.identityName, "crewbot");

  const explicit = resolveDesktopProfilePath({
    appData,
    isPackaged: true,
    env: { CREWBOT_PROFILE_DIR: path.join(tmpdir(), "isolated-profile") },
    exists: () => true,
  });
  assert.equal(explicit.profilePath, path.join(tmpdir(), "isolated-profile"));
  assert.equal(explicit.legacy, false);
  assert.equal(explicit.identityName, "crewbot");
});
