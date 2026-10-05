// Focused regressions for the pieces of the native service fixture that decide
// whether a stopped unit is really gone.
//
// These run on any Linux host with Node and touch no systemd unit, no package
// and no user data. They exercise the real exported helpers against real
// processes this file owns: `systemctl show --value` prints text, so a pid read
// from it has to be parsed before it can be compared as a number, and the
// stop decision must survive a pid that is still running.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, describe, it } from "node:test";

import { parseMainPid, pidIsAlive, unitMainPid } from "./testing/linux-service-fixture.mjs";

/** Every process this file starts, each with the one `closed` promise that
 * settles exactly once. The promise is registered at spawn and kept, so a test
 * that already waited for `close` leaves a settled promise behind instead of a
 * `once` listener that can never fire again — cleanup still forces the kill. */
const owned = [];
const survivors = [];
after(async () => {
  for (const child of owned) {
    child.kill("SIGKILL");
    await child.closed;
  }
  // The point of the hook is that nothing this file started outlives it, whether
  // the test reaped its own child or left that to the hook.
  for (const pid of survivors) {
    assert.equal(pidIsAlive(pid), false, `pid ${pid} survived the cleanup hook`);
  }
});

async function spawnIdleNode() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const closed = new Promise((done) => child.once("close", done));
  owned.push(Object.assign(child, { closed }));
  await new Promise((done, failOnce) => {
    child.once("spawn", done);
    child.once("error", failOnce);
  });
  return child;
}

describe("the pid systemd reports", () => {
  it("parses the text systemctl prints into a usable pid", () => {
    assert.equal(parseMainPid("4242"), 4242);
    assert.equal(parseMainPid(" 4242\n"), 4242);
    assert.equal(parseMainPid(4242), 4242);
  });

  it("refuses anything that is not a live pid instead of guessing", () => {
    // A stopped unit reports MainPID=0, an absent unit reports nothing, and a
    // client that failed reports noise. None of them name a process.
    assert.equal(parseMainPid("0"), null);
    assert.equal(parseMainPid(""), null);
    assert.equal(parseMainPid(null), null);
    assert.equal(parseMainPid(undefined), null);
    assert.equal(parseMainPid("-7"), null);
    assert.equal(parseMainPid("1.5"), null);
    assert.equal(parseMainPid("MainPID=4242"), null);
    assert.equal(parseMainPid("4242 (gone)"), null);
    assert.equal(parseMainPid(Number.NaN), null);
  });

  it("reads a unit systemd does not know as no pid", () => {
    const absent = "omb-no-such-unit-fixture.service";
    assert.equal(unitMainPid(absent), null, `${absent} must report no main pid`);
  });
});

describe("whether a stopped unit's process is really gone", () => {
  it("observes a live process this test owns, then reports it gone", async () => {
    const child = await spawnIdleNode();
    const pid = parseMainPid(String(child.pid));
    assert.equal(pid, child.pid);
    assert.equal(pidIsAlive(pid), true, "a running owned process must read as alive");

    child.kill("SIGKILL");
    await child.closed;
    assert.equal(pidIsAlive(pid), false, "the pid must stop reading as alive once the process exits");
  });

  it("leaves a child for cleanup to force down when the test does not reap it", async () => {
    const child = await spawnIdleNode();
    const pid = parseMainPid(String(child.pid));
    assert.equal(pidIsAlive(pid), true, "a child this test never stopped must still be running");
    // Deliberately no kill and no wait here: the after hook owns this one, and
    // `survivors` is what proves the hook did the killing.
    survivors.push(pid);
  });

  it("treats a pid it cannot signal as alive, and a missing one as gone", () => {
    // EPERM means the process exists but this account may not signal it, so the
    // data-dir lease is still held and the stop is not complete. pid 1 always
    // exists, and this assertion is the same either way the account is
    // privileged enough to signal it directly.
    assert.equal(pidIsAlive(1), true);
    // Nothing this test owns or can name is a usable pid.
    assert.equal(pidIsAlive(null), false);
    assert.equal(pidIsAlive(undefined), false);
    assert.equal(pidIsAlive(0), false);
    assert.equal(pidIsAlive(-1), false);
    assert.equal(pidIsAlive(2 ** 31 - 1), false);
  });
});