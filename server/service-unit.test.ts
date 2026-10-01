import { describe, expect, it } from "vitest";

import { launchdPlist, serviceCommand, servicePlan, systemdUnit, unstableInstallWarning, type ServiceSpec } from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/crewbot/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/maus/.crewbot", "--domain", "maus.example.com", "--no-pair"],
  dataDir: "/home/maus/.crewbot",
  user: "maus",
  home: "/home/maus",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/crewbot/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/OpenMausBot/server/openmausbot.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=crewbot (agentada)");
    expect(unit).toContain("User=maus");
    expect(unit).toContain("Environment=CREWBOT_DATA_DIR=/home/maus/.crewbot\nEnvironment=OMB_DATA_DIR=/home/maus/.crewbot");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/crewbot/cli.js serve --port 8799 --data-dir /home/maus/.crewbot --domain maus.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/maus/.crewbot"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    // a path with a space is quoted for systemd
    expect(systemdUnit({ ...spec, dataDir: "/home/maus/My Data", serveArgs: ["--data-dir", "/home/maus/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/crewbot/cli.js serve --data-dir "/home/maus/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/maus", dataDir: "/Users/maus/.crewbot" });
    expect(plist).toContain("<string>dev.xddinside.crewbot.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>maus.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>CREWBOT_DATA_DIR</key>\n\t\t<string>/Users/maus/.crewbot</string>\n\t\t<key>OMB_DATA_DIR</key>\n\t\t<string>/Users/maus/.crewbot</string>");
    expect(plist).toContain("/Users/maus/.crewbot/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/maus/.npm/_npx/abc123/node_modules/crewbot/cli.js")).toMatch(/npm install -g crewbot/);
    expect(unstableInstallWarning("/usr/lib/node_modules/crewbot/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/maus/.crewbot");
    expect(linux?.installed).toBe("/etc/systemd/system/crewbot.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now crewbot");
    expect(linux?.prepareLegacy).toContain("sudo test -f /etc/systemd/system/openmausbot.service");
    expect(linux?.prepareLegacy).toContain("sudo test ! -e /etc/systemd/system/openmausbot.service.crewbot-backup");
    expect(linux?.prepareLegacy?.join("\n")).toContain("cp --preserve=all /etc/systemd/system/openmausbot.service /etc/systemd/system/openmausbot.service.crewbot-backup");
    expect(linux?.prepareLegacy?.join("\n")).toContain("systemctl disable --now openmausbot.service");
    expect(linux?.retireLegacy?.join("\n")).toContain("rm /etc/systemd/system/openmausbot.service");
    expect(linux?.legacyUnit).toBe("/etc/systemd/system/openmausbot.service");
    expect(linux?.legacyBackup).toBe("/etc/systemd/system/openmausbot.service.crewbot-backup");
    expect(linux?.prepareLegacy?.join(" ")).not.toMatch(/&&|\bif\b|\|/);
    expect(linux?.retireLegacy?.join(" ")).not.toMatch(/&&|\bif\b|\|/);
    const mac = servicePlan("darwin", "/Users/maus/.crewbot", "/Users/maus");
    expect(mac?.installed).toBe("/Users/maus/Library/LaunchAgents/dev.xddinside.crewbot.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });
});
