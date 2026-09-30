import assert from "node:assert/strict";
import test from "node:test";

import { resolveDesktopProfilePath } from "./profile-path.mjs";

test("source launches use a dedicated profile even when a stable profile override is inherited", () => {
  const result = resolveDesktopProfilePath({
    appData: "/home/test/.config",
    isPackaged: false,
    platform: "linux",
    env: { CREWBOT_PROFILE_DIR: "/home/test/.config/crewbot" },
    exists: () => true,
  });
  assert.equal(result.profilePath, "/home/test/.config/crewbot-development");
  assert.equal(result.legacy, false);
});

test("packaged upgrades keep using the existing OpenMausBot profile for OS-encrypted credentials", () => {
  const result = resolveDesktopProfilePath({
    appData: "/home/test/.config",
    isPackaged: true,
    platform: "linux",
    env: {},
    exists: (candidate) => candidate === "/home/test/.config/OpenMausBot",
  });
  assert.equal(result.profilePath, "/home/test/.config/OpenMausBot");
  assert.equal(result.legacy, true);
  assert.equal(result.newProfilePath, "/home/test/.config/crewbot");
});

test("new installs and explicit stable profile paths remain deliberate", () => {
  const fresh = resolveDesktopProfilePath({ appData: "/appdata", isPackaged: true, env: {}, exists: () => false });
  assert.equal(fresh.profilePath, "/appdata/crewbot");

  const explicit = resolveDesktopProfilePath({
    appData: "/appdata",
    isPackaged: true,
    env: { CREWBOT_PROFILE_DIR: "/var/tmp/isolated-profile" },
    exists: () => true,
  });
  assert.equal(explicit.profilePath, "/var/tmp/isolated-profile");
  assert.equal(explicit.legacy, false);
});
