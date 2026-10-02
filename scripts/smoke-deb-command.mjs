// Proves the line the app hands a Ubuntu user actually installs, and that the
// command it replaced does not.
//
// The .deb update path ends with a command on the clipboard: the app
// deliberately never installs the package itself. That makes the command the
// whole deliverable, so it is executed here as root on a clean Ubuntu, through
// a real shell, exactly as pasted — quoting included.
//
//   node scripts/smoke-deb-command.mjs <path-to-deb>
//
// Needs a container runtime; installing a system package is the point.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { packageInstallCommand } from "../electron/package-install-command.mjs";

const IMAGE = process.env.OMB_DEB_SMOKE_IMAGE || "ubuntu:24.04";
const RUNTIME = process.env.OMB_DEB_SMOKE_RUNTIME || "docker";
if (!["docker", "podman"].includes(RUNTIME)) throw new Error("unsupported container runtime");

function fail(message) {
  console.error(`[smoke-deb-command] ${message}`);
  process.exit(1);
}

const deb = path.resolve(process.argv[2] ?? "");
if (!deb.endsWith(".deb") || !existsSync(deb)) fail("pass the path to a .deb");

// Inside the container the package sits at a path with a space and an
// apostrophe, so the quoting the app emits is exercised, not assumed.
const staged = "/root/pending dir/o'brien/crewbot.deb";
const command = packageInstallCommand("deb", staged);
console.log(`[smoke-deb-command] command under test:\n    ${command}\n`);

function inContainer(script, { expectFailure = false } = {}) {
  try {
    const output = execFileSync(
      RUNTIME,
      [
        "run", "--rm",
        "-v", `${deb}:/tmp/package.deb:ro`,
        "-e", "DEBIAN_FRONTEND=noninteractive",
        IMAGE,
        "/bin/bash", "-c", script,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60 * 1000 },
    );
    if (expectFailure) fail("the command was expected to fail but succeeded");
    return output;
  } catch (error) {
    if (expectFailure) return String(error.stdout ?? "") + String(error.stderr ?? "");
    const stdout = String(error.stdout ?? "");
    const stderr = String(error.stderr ?? "");
    const logBase = path.join(tmpdir(), `omb-linux-smoke-deb-command-${process.pid}-${Date.now()}`);
    const stdoutPath = `${logBase}.stdout.log`;
    const stderrPath = `${logBase}.stderr.log`;
    writeFileSync(stdoutPath, stdout);
    writeFileSync(stderrPath, stderr);
    writeSync(2, `[smoke-deb-command] full container output saved to ${stdoutPath} and ${stderrPath}\n`);
    for (const [label, output] of [["stdout", stdout], ["stderr", stderr]]) {
      const tail = output.split(/\r?\n/).slice(-120).join("\n");
      writeSync(2, `[smoke-deb-command] last 120 ${label} lines:\n${tail}\n`);
    }
    const reason = error.status != null ? `exit ${error.status}` : error.signal ?? error.code ?? "unknown failure";
    throw new Error(`container command failed (${reason}); complete output is in the saved logs`);
  }
}

// Everything before the command under test is setup; `set -e` keeps a failed
// setup from being read as a failed install.
const prepare = [
  "set -e",
  "apt-get update -qq",
  "apt-get install -y -qq sudo >/dev/null",
  `printf 'Dpkg::Use-Pty "0";\\n' > /etc/apt/apt.conf.d/99-smoke-no-pty`,
  `mkdir -p "$(dirname "${staged}")"`,
  `cp /tmp/package.deb "${staged}"`,
].join("\n");

console.log("[smoke-deb-command] installing with the command the app hands over…");
const installed = inContainer(
  [
    prepare,
    command,
    'dpkg-query -W -f="INSTALLED=\\${Version} \\${db:Status-Abbrev}\\n" crewbot',
    'test -x /opt/crewbot/crewbot && echo "EXECUTABLE=yes"',
  ].join("\n"),
);

const version = installed.match(/INSTALLED=(\S+) (\S+)/);
const checks = [
  ["the package installed and configured", version?.[2]?.startsWith("ii") === true],
  ["the app binary is in place", installed.includes("EXECUTABLE=yes")],
];

// The command this replaced. On a clean Ubuntu the dependencies are not
// present, and dpkg resolves none of them — which is why the old in-app
// installer could leave a user with a broken package.
console.log("[smoke-deb-command] control: the `dpkg -i` the app used to run…");
const control = inContainer([prepare, `dpkg -i "${staged}" || echo "DPKG_FAILED"`].join("\n"), {
  expectFailure: false,
});
checks.push([
  "`dpkg -i` alone fails where the handed-over command works",
  control.includes("DPKG_FAILED") || /dependency problems|not installed/i.test(control),
]);

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✔" : "✖"} ${label}`);
  if (!ok) failed += 1;
}
if (failed > 0) fail(`${failed} check(s) failed`);
console.log(`[smoke-deb-command] OK — ${version[1]} installed by the command the app copies`);
