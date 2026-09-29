// A user upgrading from the pre-rename data dir (~/.opengrokbot) must find
// everything in ~/.crewbot after the first boot. Anything that touches
// the new dir before ensureDirs() runs would make that rename a no-op and
// boot the user into an empty workspace — this test pins the order.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const WEBHOOK_PORT = 39000 + Math.floor(Math.random() * 10_000);
const CLI_PORT = 28800 + Math.floor(Math.random() * 10_000);
const CLI_WEBHOOK_PORT = 49000 + Math.floor(Math.random() * 10_000);

let home: string;
let child: ChildProcess;
let stderr = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-legacy-test-"));
  const legacy = join(home, ".opengrokbot");
  mkdirSync(legacy, { recursive: true });
  // A non-product shadow keeps startup deterministic: an empty map selects
  // the user's full default engine fleet, whose installed CLI probes are not
  // part of this migration test.
  writeFileSync(join(legacy, "config.json"), JSON.stringify({
    instances: { fixture: { driver: "migration-test-shadow" } },
  }));
  writeFileSync(join(legacy, "keep-me.txt"), "carried over");
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
      OMB_WEBHOOK_PORT: String(WEBHOOK_PORT),
      OMB_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("legacy data dir", () => {
  it("is renamed to the new name on first boot, with its contents and a fresh environment id", () => {
    const fresh = join(home, ".crewbot");
    expect(existsSync(join(home, ".opengrokbot"))).toBe(false);
    expect(readFileSync(join(fresh, "keep-me.txt"), "utf8")).toBe("carried over");
    expect(readFileSync(join(fresh, "environment-id"), "utf8").trim()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("default CLI start migrates before checking setup, even though it passes CREWBOT_DATA_DIR to its child", async () => {
    const cliHome = mkdtempSync(join(tmpdir(), "crewbot-cli-legacy-test-"));
    const legacy = join(cliHome, ".openmausbot");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "config.json"), JSON.stringify({
      instances: { fixture: { driver: "migration-test-shadow" } },
      defaultModelSelection: { instanceId: "fixture", model: "fixture-model" },
    }));
    writeFileSync(join(legacy, "keep-me.txt"), "carried through CLI");
    const cli = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "openmausbot.ts"), "--port", String(CLI_PORT), "--no-pair"], {
      cwd: ROOT,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: cliHome,
        USERPROFILE: cliHome,
        OMB_WEBHOOK_PORT: String(CLI_WEBHOOK_PORT),
        OMB_BROWSER_CONNECTION: join(cliHome, "browser-test-connection.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    cli.stdout?.on("data", (chunk) => (output += String(chunk)));
    cli.stderr?.on("data", (chunk) => (output += String(chunk)));
    try {
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline && cli.exitCode === null && !ready) {
        try {
          ready = (await fetch(`http://127.0.0.1:${CLI_PORT}/api/health`)).ok;
        } catch {
          /* not up yet */
        }
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(ready, output).toBe(true);
      const fresh = join(cliHome, ".crewbot");
      expect(existsSync(legacy)).toBe(false);
      expect(readFileSync(join(fresh, "keep-me.txt"), "utf8")).toBe("carried through CLI");
      expect(existsSync(join(fresh, "openmausbot-server.lease"))).toBe(true);
    } finally {
      cli.kill("SIGTERM");
      await waitForExit(cli, { signal: "SIGTERM" });
      await removeTempDir(cliHome);
    }
  }, 40_000);
});
