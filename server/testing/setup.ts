// Vitest setup — every test file gets a throwaway home directory so
// DATA_DIR (~/.crewbot) never touches the real one. os.homedir()
// reads HOME (POSIX) / USERPROFILE (Windows) at call time, and this file
// runs before any test module imports server/config.ts.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

import { removeTempDir } from "./cleanup.ts";
import { assertDataDirIsolated } from "./data-dir-guard.ts";

// Captured before the redirect below, because after it `homedir()` can no longer
// tell us what the invoking user's real home was. Every assertion in this file
// needs both: the home we redirected to, and the one we must not touch.
const realHome = homedir();

const home = mkdtempSync(join(tmpdir(), "omb-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// CREWBOT_DATA_DIR and its OMB_DATA_DIR alias are intentional production
// overrides, but tests must never let either escape the throwaway home they
// are about to delete. Both must go: config.ts reads CREWBOT_DATA_DIR first,
// so clearing only the legacy alias lets a developer's shell silently
// redirect the whole suite at their real data dir.
delete process.env.CREWBOT_DATA_DIR;
delete process.env.OMB_DATA_DIR;
// Do not let a developer's Hermes global config path leak into per-test homes.
delete process.env.HERMES_HOME;
// The companion keeps its paired devices in its own directory, and resolves
// it from homedir() the same way — so the redirect above already covers it.
// Named explicitly all the same: the device tests delete this directory
// wholesale, and "it is safe because of a line in another file" is not the
// footing that delete should stand on.
process.env.OMB_COMPANION_DIR = join(home, ".openmausbot-companion");

// The deletes above are the fix for a real incident; this is the fence around
// it. Clearing the vars is only correct if the redirect actually took effect and
// the data dir the suite is about to resolve lands inside the throwaway home —
// and a test that cleans its data dir deletes whatever it points at, live data
// included. Both are cheap to check now and impossible to check after the
// damage, so the run refuses to start instead. Throws DataDirIsolationError.
//
// What this checks is the one thing globalSetup cannot: the value this worker's
// config module actually resolved. globalSetup runs in the main process, before
// the redirect, and only inspects the env overrides — it cannot see whether
// `homedir()` agrees with `home`, nor whether config.ts bound DATA_DIR against
// the real home. Re-deriving the path from env here would be tautological: the
// deletes above leave no override, so the mirror can only ever yield
// `home/.crewbot` and can never fail. Ask the module instead.
//
// The import must stay dynamic and must sit below the redirect. A static import
// at the top of this file would hoist config.ts above it, bind DATA_DIR to the
// real home, and make this assertion fire on every run for the wrong reason.
const { DATA_DIR } = await import("../config.ts");
assertDataDirIsolated(DATA_DIR, home, realHome);

// Product code follows navigator.language, which makes English assertions
// depend on the developer or CI host locale. Keep the shared default stable;
// dedicated i18n tests explicitly select every translated pack they exercise.
Object.defineProperty(globalThis.navigator, "language", { value: "en", configurable: true });

// SQLite keeps the database file open for the lifetime of its handle.
// Windows will not remove a directory containing an open database, so close
// the per-test handle before the next test resets its throwaway data dir.
const { closeMessageDb } = await import("../message-db.ts");
afterEach(closeMessageDb);

// Windows holds a directory that is a live process's cwd, and a just-killed
// CLI lets go a beat after the kill call returns — see removeTempDir.
afterAll(async () => {
  closeMessageDb();
  await removeTempDir(home);
});
