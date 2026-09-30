import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import {
  assertDataDirIsolated,
  assertNoLiveDataDirOverride,
  DataDirIsolationError,
  liveDataDirs,
  resolveDataDir,
} from "./data-dir-guard.ts";

// The real home is never written to by anything here; these are path-string
// assertions about a hypothetical one, which is the point — the guard has to
// reject a live dir before the suite ever creates or removes anything.
const REAL_HOME = "/home/someone";
const THROWAWAY = "/tmp/omb-test-home-abc123";

describe("resolveDataDir", () => {
  it("prefers CREWBOT_DATA_DIR over the OMB_DATA_DIR alias", () => {
    expect(
      resolveDataDir(
        { CREWBOT_DATA_DIR: "/tmp/crew", OMB_DATA_DIR: "/tmp/omb" },
        THROWAWAY,
      ),
    ).toBe("/tmp/crew");
  });

  it("falls back to the OMB_DATA_DIR alias", () => {
    expect(resolveDataDir({ OMB_DATA_DIR: "/tmp/omb" }, THROWAWAY)).toBe("/tmp/omb");
  });

  it("defaults to ~/.crewbot under the given home", () => {
    expect(resolveDataDir({}, THROWAWAY)).toBe(join(THROWAWAY, ".crewbot"));
  });

  it("ignores an empty or whitespace override", () => {
    expect(resolveDataDir({ CREWBOT_DATA_DIR: "   " }, THROWAWAY)).toBe(
      join(THROWAWAY, ".crewbot"),
    );
  });

  // Without this the helper quietly drifts from production and the guard starts
  // rejecting good runs while passing bad ones. config.ts resolves at import,
  // which is the throwaway home because setup.ts redirects first.
  it("agrees with server/config.ts", () => {
    expect(resolveDataDir({}, homedir())).toBe(DATA_DIR);
  });
});

describe("assertDataDirIsolated", () => {
  it("rejects the live ~/.crewbot that the 2026-09-29 incident destroyed", () => {
    expect(() =>
      assertDataDirIsolated("/home/someone/.crewbot", THROWAWAY, REAL_HOME),
    ).toThrow(DataDirIsolationError);
  });

  it("rejects a live ~/.openmausbot", () => {
    expect(() =>
      assertDataDirIsolated("/home/someone/.openmausbot", THROWAWAY, REAL_HOME),
    ).toThrow(DataDirIsolationError);
  });

  it("rejects a live dir reached by a traversal rather than a literal path", () => {
    expect(() =>
      assertDataDirIsolated(
        resolve(join(THROWAWAY, "..", "..", "home", "someone", ".crewbot")),
        THROWAWAY,
        REAL_HOME,
      ),
    ).toThrow(DataDirIsolationError);
  });

  it("rejects a dir outside the throwaway home, so a failed redirect is loud", () => {
    expect(() => assertDataDirIsolated("/tmp/elsewhere", THROWAWAY, REAL_HOME)).toThrow(
      DataDirIsolationError,
    );
  });

  it("rejects the real home's default when the redirect did not take", () => {
    expect(() =>
      assertDataDirIsolated(resolve(join(REAL_HOME, ".crewbot")), REAL_HOME, REAL_HOME),
    ).toThrow(DataDirIsolationError);
  });

  it("allows a dir inside the throwaway home", () => {
    expect(() =>
      assertDataDirIsolated(join(THROWAWAY, ".crewbot"), THROWAWAY, REAL_HOME),
    ).not.toThrow();
  });

  it("allows the throwaway home itself", () => {
    expect(() => assertDataDirIsolated(THROWAWAY, THROWAWAY, REAL_HOME)).not.toThrow();
  });

  it("names the offending dir in the message", () => {
    expect(() =>
      assertDataDirIsolated("/home/someone/.crewbot", THROWAWAY, REAL_HOME),
    ).toThrow(/\/home\/someone\/\.crewbot/);
  });
});

describe("assertNoLiveDataDirOverride", () => {
  it("rejects the exact env that caused the wipe", () => {
    expect(() =>
      assertNoLiveDataDirOverride({ CREWBOT_DATA_DIR: "/home/someone/.crewbot" }, REAL_HOME),
    ).toThrow(DataDirIsolationError);
  });

  it("rejects the legacy alias too", () => {
    expect(() =>
      assertNoLiveDataDirOverride({ OMB_DATA_DIR: "/home/someone/.crewbot" }, REAL_HOME),
    ).toThrow(DataDirIsolationError);
  });

  it("allows an unset or empty override", () => {
    expect(() => assertNoLiveDataDirOverride({}, REAL_HOME)).not.toThrow();
    expect(() => assertNoLiveDataDirOverride({ CREWBOT_DATA_DIR: "" }, REAL_HOME)).not.toThrow();
  });

  // A developer running a sandbox on purpose must not be blocked by the fence.
  it("allows a deliberate sandbox override outside the real home", () => {
    expect(() =>
      assertNoLiveDataDirOverride({ CREWBOT_DATA_DIR: "/tmp/omb-sandbox-07PWU0" }, REAL_HOME),
    ).not.toThrow();
  });

  // The case that motivated the rule. Nothing under /home/xdd is read or
  // written here: this is a path-string assertion, same as the ones above.
  it("rejects the 2026-09-29 archive the name list never covered", () => {
    expect(() =>
      assertNoLiveDataDirOverride(
        { OMB_DATA_DIR: "/home/xdd/.openmausbot-archive-2026-09-29" },
        "/home/xdd",
        "/tmp",
      ),
    ).toThrow(DataDirIsolationError);
  });

  // The name list only ever holds the names someone thought of. Location is
  // the property the suite can actually rely on.
  it("rejects an unnamed directory inside the real home", () => {
    expect(() =>
      assertNoLiveDataDirOverride(
        { CREWBOT_DATA_DIR: "/home/someone/scratch/crewbot-data" },
        REAL_HOME,
        "/tmp",
      ),
    ).toThrow(/\/home\/someone\/scratch\/crewbot-data/);
  });

  it("rejects the real home itself", () => {
    expect(() =>
      assertNoLiveDataDirOverride({ CREWBOT_DATA_DIR: REAL_HOME }, REAL_HOME, "/tmp"),
    ).toThrow(DataDirIsolationError);
  });

  it("allows an override under the temp root, where throwaway homes are made", () => {
    expect(() =>
      assertNoLiveDataDirOverride(
        { CREWBOT_DATA_DIR: "/tmp/omb-test-home-abc123/.crewbot" },
        REAL_HOME,
        "/tmp",
      ),
    ).not.toThrow();
  });
});

describe("liveDataDirs", () => {
  it("covers both the fork's and the legacy dir names", () => {
    expect(liveDataDirs(REAL_HOME)).toEqual([
      join(REAL_HOME, ".crewbot"),
      join(REAL_HOME, ".openmausbot"),
    ]);
  });
});
