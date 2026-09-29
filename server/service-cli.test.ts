import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runServiceCommand, serviceServeArgs } from "./service-cli.ts";
import { removeTempDir } from "./testing/cleanup.ts";

describe("crewbot service", () => {
  let dir: string;
  const out: string[] = [];
  const err: string[] = [];
  const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-service-"));
    out.length = 0;
    err.length = 0;
  });
  afterEach(() => removeTempDir(dir));

  it("repeats the serve options, one access mode at a time", () => {
    expect(serviceServeArgs({ port: 8799, dataDir: "/d", domain: "a.example.com", tunnel: true, label: "x" })).toEqual(["--port", "8799", "--data-dir", "/d", "--no-pair", "--domain", "a.example.com", "--label", "x"]);
    expect(serviceServeArgs({ port: 1, dataDir: "/d", tailscale: true })).toEqual(["--port", "1", "--data-dir", "/d", "--no-pair", "--tailscale"]);
  });

  it("writes the unit next to the data and prints how to install it; refuses an npx cache", () => {
    const code = runServiceCommand({ action: "install", dataDir: dir, port: 8799, domain: "maus.example.com", script: "/usr/lib/node_modules/crewbot/cli.js", node: "/usr/bin/node", platform: "linux", home: "/home/maus", user: "maus" }, io);
    expect(code).toBe(0);
    const unit = readFileSync(join(dir, "crewbot.service"), "utf8");
    expect(unit).toContain("--domain maus.example.com");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(out.join("\n")).toContain("sudo systemctl enable --now crewbot");
    expect(out.join("\n")).toContain("no setcap is needed");

    out.length = 0;
    const refused = runServiceCommand({ action: "install", dataDir: join(dir, "x"), port: 8799, script: "/home/maus/.npm/_npx/deadbeef/node_modules/crewbot/cli.js", node: "/usr/bin/node", platform: "linux" }, io);
    expect(refused).toBe(1);
    expect(err.join("\n")).toMatch(/npm install -g crewbot/);
    expect(existsSync(join(dir, "x", "crewbot.service"))).toBe(false);
  });

  it("imports legacy data before service install creates the default data directory", () => {
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const legacy = join(dir, ".openmausbot");
    const dataDir = join(dir, ".crewbot");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "fixture.txt"), "legacy workspace");
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    try {
      expect(runServiceCommand({
        action: "install", dataDir, port: 8799, script: "/usr/lib/node_modules/crewbot/cli.js", node: "/usr/bin/node",
        platform: "linux", home: dir, user: "crewbot",
      }, io)).toBe(0);
      expect(existsSync(legacy)).toBe(false);
      expect(readFileSync(join(dataDir, "fixture.txt"), "utf8")).toBe("legacy workspace");
      expect(existsSync(join(dataDir, "crewbot.service"))).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it("writes a launchd agent on macOS and explains uninstall on both", () => {
    expect(runServiceCommand({ action: "install", dataDir: dir, port: 8799, tunnel: true, script: "/opt/homebrew/lib/node_modules/crewbot/cli.js", node: "/opt/homebrew/bin/node", platform: "darwin", home: "/Users/maus" }, io)).toBe(0);
    expect(readFileSync(join(dir, "dev.xddinside.crewbot.serve.plist"), "utf8")).toContain("<string>--tunnel</string>");
    expect(out.join("\n")).toContain("launchctl bootstrap");
    out.length = 0;
    expect(runServiceCommand({ action: "uninstall", dataDir: dir, port: 8799, script: "/x", node: "/n", platform: "linux" }, io)).toBe(0);
    expect(out.join("\n")).toContain("sudo systemctl disable --now crewbot");
    expect(runServiceCommand({ action: "install", dataDir: dir, port: 8799, script: "/x", node: "/n", platform: "win32" }, io)).toBe(1);
  });
});
