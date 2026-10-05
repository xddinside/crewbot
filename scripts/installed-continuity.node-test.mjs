// Focused regressions for the Linux installed-continuity fixture.
//
// These run on any host with Node: they exercise the real functions the runner
// fixture uses, against real temporary directories and the repository's own
// production modules. They are NOT the installed-continuity proof — nothing
// here installs a package, starts a display, or touches a keyring. Their job is
// to fail closed on a bad input and to keep the pure decisions honest so the
// runner step only has to exercise the native boundaries.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { after, describe, it } from "node:test";

import {
  assertPinnedFile,
  assertIsolatedSessionEnv,
  LIVE_SESSION_VARIABLES,
  verifyCandidateArtifact,
} from "./installed-continuity/inputs.mjs";
import {
  createFixtureEnvironment,
  fixtureBaseEnv,
  listTree,
  readTextIfPresent,
} from "./installed-continuity/environment.mjs";
import { ProductionServer, digestTree } from "./installed-continuity/workspace.mjs";
import {
  assertInside,
  assertOutside,
  assertRefusalPreservedOriginals,
  assertRegularFile,
  auditCredentialSurvival,
  auditStableDevelopmentSeparation,
  compareBytes,
  compareSnapshots,
  findResidualRoot,
  isInside,
} from "./installed-continuity/assertions.mjs";
import { resolveDesktopProfilePath } from "../electron/profile-path.mjs";
import { workspaceCredentialEnv } from "../electron/workspace-credentials.mjs";

const temporaries = [];
function scratch(label) {
  const path = mkdtempSync(join(tmpdir(), `omb-continuity-${label}-`));
  temporaries.push(path);
  return path;
}
after(() => {
  for (const path of temporaries) rmSync(path, { recursive: true, force: true, maxRetries: 3 });
});

/** Run a block with this process's own session variables cleared. The values
 * are only hidden from the fixture builder and restored afterwards; nothing
 * here reads or writes the developer's live desktop, bus or keyring. */
function withClearedSessionEnv(run) {
  const saved = new Map();
  for (const key of LIVE_SESSION_VARIABLES) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("pinned package inputs", () => {
  it("accepts the exact bytes and fails closed on a digest or size mismatch", () => {
    const directory = scratch("pinned");
    const path = join(directory, "package.deb");
    const bytes = Buffer.from(randomBytes(64));
    writeFileSync(path, bytes);
    const sha256 = pinnedDigest(bytes);
    assert.deepEqual(
      assertPinnedFile(path, { sha256, bytes: bytes.byteLength }, "old package"),
      { path, bytes: bytes.byteLength, sha256 },
    );
    assert.throws(() => assertPinnedFile(path, { sha256: "0".repeat(64) }, "old package"), /digest mismatch/);
    assert.throws(() => assertPinnedFile(path, { sha256, bytes: bytes.byteLength + 1 }, "old package"), /size mismatch/);
    assert.throws(() => assertPinnedFile(join(directory, "absent.deb"), { sha256, bytes: 1 }, "old package"));
  });

  it("refuses an artifact that does not match the pinned manifest exactly", () => {
    const directory = scratch("artifact");
    const manifest = { version: "0.1.84", files: [{ name: "crewbot-amd64.deb", bytes: 3, sha256: pinnedDigest(Buffer.from("abc")) }] };
    // The shared release validator runs first, so a one-file directory fails
    // before the per-file comparison is even reached.
    assert.throws(() => verifyCandidateArtifact(directory, manifest), /release asset/i);
    writeFileSync(join(directory, "crewbot-amd64.deb"), "abc");
    assert.throws(() => verifyCandidateArtifact(directory, manifest), /release asset/i);
  });

  it("refuses to run with a display, session bus or keyring it does not own", () => {
    assert.deepEqual(assertIsolatedSessionEnv({}), []);
    assert.deepEqual(assertIsolatedSessionEnv(Object.fromEntries(LIVE_SESSION_VARIABLES.map((key) => [key, ""]))), []);
    for (const key of LIVE_SESSION_VARIABLES) {
      assert.throws(() => assertIsolatedSessionEnv({ [key]: "/run/user/1000/bus" }), /unset/, `${key} must be refused`);
    }
  });
});

describe("the owned fixture world", () => {
  it("puts the external project outside every data root and cleans everything it made", () => {
    const root = scratch("world");
    const fixture = withClearedSessionEnv(() => createFixtureEnvironment(root, "omb-continuity-test-"));
    try {
      for (const path of [fixture.home, fixture.config, fixture.data, fixture.cache, fixture.runtime, fixture.tmp, fixture.project]) {
        assert.ok(existsSync(path), `${path} must exist`);
      }
      assert.ok(!isInside(fixture.home, fixture.project));
      assert.ok(!isInside(join(fixture.home, ".crewbot"), fixture.project));
      assert.equal(readFileSync(join(fixture.project, "PROJECT.md"), "utf8"), "external project that must not move\n");
      assert.deepEqual(listTree(fixture.project), ["PROJECT.md"]);
      const env = fixtureBaseEnv(fixture, { display: ":99", dbusAddress: "unix:path=/owned/dbus", keyringControl: "keyring:owned=1" });
      assert.equal(env.HOME, fixture.home);
      assert.equal(env.DISPLAY, ":99");
      assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/owned/dbus");
      assert.equal(env.GNOME_KEYRING_CONTROL, "keyring:owned=1");
      for (const key of LIVE_SESSION_VARIABLES) {
        if (key === "DISPLAY" || key === "XDG_RUNTIME_DIR" || key === "DBUS_SESSION_BUS_ADDRESS" || key === "GNOME_KEYRING_CONTROL") continue;
        assert.equal(env[key], undefined, `${key} must not be spread into a fixture child`);
      }
      assert.equal(readTextIfPresent(join(fixture.project, "absent")), null);
    } finally {
      const owned = fixture.root;
      fixture.stop();
      assert.ok(!existsSync(owned), "teardown must remove the owned root");
    }
  });

  it("refuses to build anything while a live session is still inherited", () => {
    const root = scratch("polluted");
    const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
    process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1000/bus";
    try {
      assert.throws(() => createFixtureEnvironment(root), /DBUS_SESSION_BUS_ADDRESS/);
    } finally {
      if (previous === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
      else process.env.DBUS_SESSION_BUS_ADDRESS = previous;
    }
    // The developer's own session must not be editable by a fixture even when
    // the value is inherited rather than written by us.
    assert.throws(() => assertIsolatedSessionEnv({ DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1" }), /unset/);
  });
});

describe("path and byte comparisons", () => {
  it("finds a residual old data root anywhere in a persisted document", () => {
    const source = "/tmp/home/.openmausbot";
    assert.equal(findResidualRoot({ cwd: "/elsewhere" }, source), null);
    assert.equal(findResidualRoot({ cwd: `${source}/tasks/1` }, source).residuals.length, 1);
    const nested = findResidualRoot({ tasks: [{ cwd: `${source}/a` }], list: [`${source}/b`] }, source);
    assert.deepEqual(nested.residuals.map((entry) => entry.path).sort(), ["list[0]", "tasks[0].cwd"]);
    // An external project path must never look like a residual.
    assert.equal(findResidualRoot({ cwd: "/tmp/owner/external-project" }, source), null);
  });

  it("separates an embedded workspace path from an external project path", () => {
    assert.ok(isInside("/tmp/home/.openmausbot", "/tmp/home/.openmausbot/tasks"));
    assert.ok(!isInside("/tmp/home/.openmausbot", "/tmp/home/.openmausbot-other/tasks"));
    assert.ok(!isInside("/tmp/home/.openmausbot", "/tmp/project"));
    assert.equal(assertInside("the attachment", "/tmp/a", "/tmp/a/b"), "/tmp/a/b");
    assert.throws(() => assertInside("the attachment", "/tmp/a", "/tmp/b"), /is not inside/);
    assert.equal(assertOutside("the project", "/tmp/a", "/tmp/b"), "/tmp/b");
    assert.throws(() => assertOutside("the project", "/tmp/a", "/tmp/a/b"), /must stay outside/);
  });

  it("compares attachment bytes by digest and refuses a change", () => {
    const bytes = randomBytes(512);
    const digest = compareBytes(pinnedDigest(bytes), pinnedDigest(bytes));
    assert.equal(digest.bytes, null);
    assert.equal(compareBytes(bytes, Buffer.from(bytes)).sha256, digest.sha256);
    assert.throws(() => compareBytes(bytes, Buffer.concat([bytes, Buffer.from("x")])), /size changed/);
    const same = Buffer.from(bytes);
    same[0] ^= 0xff;
    assert.throws(() => compareBytes(bytes, same), /bytes changed/);
  });

  it("requires the migration recovery snapshot to hold the original bytes", () => {
    const source = scratch("snapshot-source");
    const target = scratch("snapshot-target");
    writeFileSync(join(source, "bots.json"), '{"a":1}');
    writeFileSync(join(source, "messages.db"), "sqlite-bytes");
    const before = digestTree(source);
    const snapshotDir = join(target, "recovery", "id");
    mkdirSync(snapshotDir, { recursive: true });
    for (const name of before.keys()) writeFileSync(join(snapshotDir, name), readFileSync(join(source, name)));
    assert.deepEqual(compareSnapshots({ before, snapshotDir, expect: [...before.keys()] }).verified.length, 2);
    assert.throws(() => compareSnapshots({ before, snapshotDir, expect: ["absent.json"] }), /missing absent.json/);
    writeFileSync(join(snapshotDir, "bots.json"), '{"a":2}');
    assert.throws(
      () => compareSnapshots({ before, snapshotDir, expect: ["bots.json"] }),
      /does not match the original bytes: bots.json/,
    );
  });

  it("names a real file and refuses anything else", () => {
    const directory = scratch("regular");
    const file = join(directory, "plain");
    writeFileSync(file, "x");
    assert.equal(assertRegularFile(file).bytes, 1);
    assert.throws(() => assertRegularFile(directory), /expected a real file/);
  });
});

describe("bounded readiness", () => {
  /** The wait only needs a child handle it never touches, and one is disposed
   * of here rather than left to a fixture that never launched anything. */
  function idleServer() {
    const child = new EventEmitter();
    return new ProductionServer({ child, url: "http://127.0.0.1:1", port: 1, dataDir: "/none", logPath: "/none" });
  }

  it("returns the first real result and retries a false probe", async () => {
    const server = idleServer();
    let probes = 0;
    const found = await server.waitFor(() => {
      probes += 1;
      return probes < 3 ? null : { ready: true, probes };
    }, { budgetMs: 5_000, label: "a real result" });
    assert.deepEqual(found, { ready: true, probes: 3 });
    assert.equal(probes, 3, "a false probe must be retried, not accepted");
  });

  it("never treats a throwing probe as the result it was waiting for", async () => {
    const server = idleServer();
    let probes = 0;
    await assert.rejects(
      server.waitFor(() => {
        probes += 1;
        throw new Error("connection refused");
      }, { budgetMs: 400, label: "a server that never answers" }),
      (error) => {
        assert.match(error.message, /timed out waiting for a server that never answers/);
        assert.match(error.message, /last probe failed: connection refused/);
        return true;
      },
    );
    assert.ok(probes >= 2, `a throwing probe must be retried until the budget ends (probes: ${probes})`);
  });

  it("keeps waiting after a failure until a probe actually succeeds", async () => {
    const server = idleServer();
    let probes = 0;
    const found = await server.waitFor(() => {
      probes += 1;
      if (probes < 2) throw new Error("the transcript is not readable yet");
      return { settled: true, probes };
    }, { budgetMs: 5_000, label: "a settled turn" });
    assert.deepEqual(found, { settled: true, probes: 2 });
  });

  it("describes the live state when the budget runs out", async () => {
    const server = idleServer();
    await assert.rejects(
      server.waitFor(() => false, {
        budgetMs: 200,
        label: "a bot state",
        describe: async () => ({ messages: 0, last: null }),
      }),
      /timed out waiting for a bot state: \{"messages":0,"last":null\}/,
    );
  });
});

describe("credential survival decisions", () => {
  const secret = "continuity-synthetic-secret";

  it("accepts an encrypted store whose keyring item the app used", () => {
    const directory = scratch("credential-ok");
    const credentialsFile = join(directory, "credentials.bin");
    writeFileSync(credentialsFile, randomBytes(256));
    const report = auditCredentialSurvival({
      credentialsFile,
      syntheticSecret: secret,
      secretServiceItems: [{ path: "/x/1", attributes: { application: "openmausbot" } }],
      identityName: "openmausbot",
      childEnvValue: secret,
      plaintextStillInConfig: false,
    });
    assert.deepEqual(report, { keyringItems: 1, identityName: "openmausbot", usedByServerChild: true });
  });

  it("fails when the backend fell back to basic_text", () => {
    const directory = scratch("credential-basic-text");
    const credentialsFile = join(directory, "credentials.bin");
    writeFileSync(credentialsFile, randomBytes(64));
    assert.throws(() => auditCredentialSurvival({
      credentialsFile,
      syntheticSecret: secret,
      secretServiceItems: [],
      identityName: "openmausbot",
      childEnvValue: secret,
      plaintextStillInConfig: false,
    }), /fell back to basic_text/);
  });

  it("fails when the store is readable as plaintext or the app never used the value", () => {
    const directory = scratch("credential-plaintext");
    const credentialsFile = join(directory, "credentials.bin");
    writeFileSync(credentialsFile, Buffer.from(secret, "utf8"));
    const items = [{ path: "/x/1", attributes: { application: "openmausbot" } }];
    assert.throws(() => auditCredentialSurvival({
      credentialsFile, syntheticSecret: secret, secretServiceItems: items,
      identityName: "openmausbot", childEnvValue: secret, plaintextStillInConfig: true,
    }), /plaintext secret is still in config.json/);
    assert.throws(() => auditCredentialSurvival({
      credentialsFile, syntheticSecret: secret, secretServiceItems: items,
      identityName: "openmausbot", childEnvValue: undefined, plaintextStillInConfig: false,
    }), /the app did not use the decrypted credential \(server saw nothing\)/);
    assert.throws(() => auditCredentialSurvival({
      credentialsFile, syntheticSecret: secret, secretServiceItems: items,
      identityName: "openmausbot", childEnvValue: "something-else", plaintextStillInConfig: false,
    }), /server saw a different value/);
  });

  it("carries the decrypted value into the server child the way the app does", () => {
    assert.equal(workspaceCredentialEnv({ xaiApiKey: secret }).XAI_API_KEY, secret);
    assert.equal(workspaceCredentialEnv({}).XAI_API_KEY, undefined);
  });
});

describe("refusal and separation decisions", () => {
  it("requires both originals and a usable next action", () => {
    const directory = scratch("refusal");
    const legacy = join(directory, ".openmausbot");
    const occupant = join(directory, ".crewbot");
    mkdirSync(legacy);
    mkdirSync(occupant);
    assert.deepEqual(assertRefusalPreservedOriginals({ legacyDirs: [legacy, occupant], expectedWarningFragments: [
      { warning: "was not migrated into /x because /y already exists and wins without merging. Keep both directories intact.", text: "was not migrated into" },
      { warning: "was not migrated into /x. Keep both directories intact.", text: "Keep both directories intact" },
    ] }).preserved, [legacy, occupant]);
    assert.throws(() => assertRefusalPreservedOriginals({
      legacyDirs: [legacy, join(directory, "gone")], expectedWarningFragments: [],
    }), /destroyed recoverable data/);
    assert.throws(() => assertRefusalPreservedOriginals({
      legacyDirs: [legacy],
      expectedWarningFragments: [{ warning: "boom", text: "Keep both directories intact" }],
    }), /usable next action/);
  });

  it("fails when a stable launch wrote into a development path", () => {
    const fixture = withClearedSessionEnv(() => createFixtureEnvironment(scratch("separation"), "omb-continuity-sep-"));
    try {
      const base = {
        home: fixture.home,
        config: fixture.config,
        data: fixture.data,
        cache: fixture.cache,
        development: fixture.development,
      };
      const observed = [join(fixture.config, "openmausbot"), join(fixture.home, ".crewbot", "messages.db")];
      const report = auditStableDevelopmentSeparation({ ...base, observed });
      assert.deepEqual(report.developmentPorts, { server: 18799, webhook: 18800 });
      assert.throws(
        () => auditStableDevelopmentSeparation({ ...base, observed: [...observed, fixture.development.dataDir] }),
        /not separated/,
      );
      assert.throws(
        () => auditStableDevelopmentSeparation({ ...base, observed: ["/home/somebody-else/.crewbot"] }),
        /outside-the-owned-fixture/,
      );
    } finally {
      fixture.stop();
    }
  });
});

describe("the profile identity the app resolves", () => {
  const appData = "/fixture/config";

  it("keeps the stable and development identities, paths and names apart", () => {
    const stable = resolveDesktopProfilePath({ appData, isPackaged: true, exists: () => false });
    const development = resolveDesktopProfilePath({ appData, isPackaged: false, exists: () => false });
    assert.equal(stable.identityName, "crewbot");
    assert.equal(development.identityName, "crewbot-development");
    assert.notEqual(stable.profilePath, development.profilePath);
    assert.equal(development.profilePath, join(appData, "crewbot-development"));
    assert.equal(stable.newProfilePath, join(appData, "crewbot"));
    assert.equal(stable.legacy, false);
  });

  it("keeps the old packaged profile and its safeStorage identity when it exists", () => {
    const withLegacy = resolveDesktopProfilePath({ appData, isPackaged: true, exists: (path) => path === join(appData, "openmausbot") });
    assert.equal(withLegacy.profilePath, join(appData, "openmausbot"));
    assert.equal(withLegacy.identityName, "openmausbot");
    assert.equal(withLegacy.legacy, true);
    // The old profile must not become a development profile.
    assert.notEqual(withLegacy.profilePath, join(appData, "crewbot-development"));
  });

  it("documents which profile wins when both Linux spellings exist", () => {
    // 0.1.83 on Linux only ever created the lower-case `openmausbot` profile.
    // `OpenMausBot` can only appear from a non-Linux profile name or a manual
    // copy, and the current order prefers it. Locking that order down here makes
    // a future change deliberate; it is recorded as a review observation for
    // the coordinator, not as a demonstrated defect.
    const both = resolveDesktopProfilePath({
      appData,
      isPackaged: true,
      exists: (path) => path === join(appData, "openmausbot") || path === join(appData, "OpenMausBot"),
    });
    assert.equal(both.profilePath, join(appData, "OpenMausBot"));
    assert.equal(both.identityName, "openmausbot");
  });

  it("never lets a development override capture a packaged launch", () => {
    const env = { CREWBOT_DEV_PROFILE_DIR: join(appData, "crewbot-development"), CREWBOT_DEV_DATA_DIR: "/tmp/dev" };
    const stable = resolveDesktopProfilePath({ appData, isPackaged: true, env, exists: () => false });
    assert.equal(stable.profilePath, join(appData, "crewbot"));
    const redirected = resolveDesktopProfilePath({ appData, isPackaged: true, env: { CREWBOT_PROFILE_DIR: "/tmp/explicit" }, exists: () => false });
    assert.equal(redirected.profilePath, "/tmp/explicit");
    assert.equal(redirected.identityName, "crewbot");
  });
});

function pinnedDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}