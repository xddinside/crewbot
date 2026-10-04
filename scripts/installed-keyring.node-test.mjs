// Native regression: owns a private bus/home/keyring and never uses a login session.
// Run explicitly on Linux with dbus, gdbus, secret-tool and gnome-keyring-daemon.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFixtureEnvironment, fixtureBaseEnv, listSecretServiceItems,
  proveKeyringRoundTrip, startOwnedKeyring, startOwnedSessionBus,
} from "./installed-continuity/environment.mjs";
import { LIVE_SESSION_VARIABLES } from "./installed-continuity/inputs.mjs";
import { runInstalledApp } from "./installed-continuity/app-launch.mjs";

for (const key of LIVE_SESSION_VARIABLES) delete process.env[key];

test("private keyring creates an unlocked default collection, round-trips and exposes item attributes", {
  timeout: 25_000, skip: process.env.OMB_NATIVE_KEYRING_TEST !== "1",
}, async () => {
  const fixture = createFixtureEnvironment(tmpdir());
  try {
    const bus = startOwnedSessionBus(fixture);
    const env = fixtureBaseEnv(fixture, { dbusAddress: bus.address });
    const keyring = await startOwnedKeyring({ env, password: randomBytes(24).toString("hex") });
    fixture.stopped.push(() => keyring.stop());
    const usable = { ...env, GNOME_KEYRING_CONTROL: keyring.control };
    assert.ok(keyring.collection.startsWith("/org/freedesktop/secrets/collection/"));
    assert.equal(proveKeyringRoundTrip(usable, { label: "fixture-roundtrip", value: randomBytes(24).toString("hex") }), true);
    assert.deepEqual(listSecretServiceItems(usable), []);
    execFileSync("secret-tool", ["store", "--label", "fixture-item", "application", "fixture-native"], {
      env: usable, input: randomBytes(24).toString("hex"), timeout: 5_000,
    });
    const items = listSecretServiceItems(usable);
    assert.equal(items.length, 1);
    assert.equal(items[0].attributes.application, "fixture-native");
    execFileSync("secret-tool", ["clear", "application", "fixture-native"], { env: usable, timeout: 5_000 });
    assert.deepEqual(listSecretServiceItems(usable), []);
  } finally {
    for (const stop of fixture.stopped.splice(0).reverse()) await stop();
    await fixture.stop();
  }
});

test("installed-app observer returns after a child exits before the polling deadline", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-launch-exit-"));
  try {
    const result = await runInstalledApp({
      executable: process.execPath, args: ["-e", "process.exit(0)"], storeArgs: [],
      env: { PATH: process.env.PATH, HOME: root }, profileDir: root, dataDir: root, timeoutMs: 2_000,
    });
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy server stages its real workspace while leaving the data-dir override unset", { timeout: 5_000 }, async () => {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const { reservePortBlock, startProductionServer } = await import("./installed-continuity/workspace.mjs");
  const root = mkdtempSync(join(tmpdir(), "omb-legacy-default-"));
  const entry = join(root, "server.mjs");
  const report = join(root, "launch.json");
  writeFileSync(entry, `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(report)}, JSON.stringify({ override: process.env.CREWBOT_DATA_DIR ?? null, dump: process.env.FAKE_CLAUDE_DUMP }));
    createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'openmausbot'}))}).listen(Number(process.env.OMB_PORT),'127.0.0.1');
  `);
  let server;
  try {
    server = await startProductionServer({
      serverEntry: entry, dataDir: root, overrideDataDir: false, env: { PATH: process.env.PATH, HOME: root },
      fakeCli: process.execPath, replies: [], port: (await reservePortBlock()).port, logPath: join(root, "server.log"), cwd: root,
    });
    assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), { override: null, dump: join(root, "fake-claude-dump.json") });
    assert.equal(JSON.parse(readFileSync(join(root, "config.json"), "utf8")).instances.claude.config.cli, process.execPath);
  } finally {
    if (server) await server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
