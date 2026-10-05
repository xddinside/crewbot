import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("preflight refusal preserves existing data even when diagnostics and failure evidence exist", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-service-cleanup-refusal-"));
  try {
    const home = join(root, "home");
    mkdirSync(join(home, ".crewbot"), { recursive: true });
    const existing = join(home, ".crewbot", "preserve.txt");
    writeFileSync(existing, "pre-existing user data");
    mkdirSync(join(root, "omb-service-cutover-diagnostics"));
    writeFileSync(join(root, "omb-service-cutover-evidence-123.json"), '{"failure":"refused pre-existing data"}');
    // No process/service utility is available. A cleanup attempt would fail.
    const output = execFileSync(process.execPath, [resolve("scripts/cleanup-linux-service-fixture.mjs"), root, "123-1", home], {
      env: { PATH: "/nonexistent", HOME: home }, encoding: "utf8", timeout: 5_000,
    });
    assert.match(output, /never claimed ownership/);
    assert.equal(readFileSync(existing, "utf8"), "pre-existing user data");
    writeFileSync(join(root, "omb-service-cutover-owned-123-1.json"), JSON.stringify({ version: 1, home: "/another-owner" }));
    assert.throws(() => execFileSync(process.execPath, [resolve("scripts/cleanup-linux-service-fixture.mjs"), root, "123-1", home], {
      env: { PATH: "/nonexistent", HOME: home }, stdio: "pipe", timeout: 5_000,
    }), /does not match this exact fixture/);
    assert.equal(readFileSync(existing, "utf8"), "pre-existing user data");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
