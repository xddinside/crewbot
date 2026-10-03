// Proves the line the app hands a Ubuntu user actually installs, and that the
// command it replaced does not.
//
// The .deb update path ends with a command on the clipboard: the app
// deliberately never installs the package itself. That makes the command the
// whole deliverable, so it is executed here as root on a clean Ubuntu, through
// a real shell, exactly as pasted — quoting included.
//
//   node scripts/smoke-deb-command.mjs <path-to-deb>
//   node scripts/smoke-deb-command.mjs <path-to-deb> --runner-chroot
//
// Default mode needs a container runtime. Restricted Ubuntu hosts cannot run
// the postinst's real AppArmor load from inside Docker; the artifact workflow
// opts into a disposable runner chroot, which proves command/dependency behavior
// and policy staging without replacing its separate native AppArmor checks.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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
const runnerChroot = process.argv[3] === "--runner-chroot";

if (process.argv[3] && !runnerChroot) fail("unknown mode; expected --runner-chroot");
if (runnerChroot && (
  process.env.GITHUB_ACTIONS !== "true"
  || process.env.RUNNER_OS !== "Linux"
  || !process.env.RUNNER_TEMP
  || path.resolve(process.env.RUNNER_TEMP) !== realpathSync(process.env.RUNNER_TEMP)
)) {
  fail("--runner-chroot is restricted to a Linux GitHub Actions runner with an owned RUNNER_TEMP");
}

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

function inRunnerChroot(root, script) {
  try {
    return execFileSync("sudo", ["-n", "chroot", root, "/bin/bash", "-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    const stdout = String(error.stdout ?? "");
    const stderr = String(error.stderr ?? "");
    const logBase = path.join(process.env.RUNNER_TEMP, `omb-linux-smoke-deb-command-${process.pid}-${Date.now()}`);
    const stdoutPath = `${logBase}.stdout.log`;
    const stderrPath = `${logBase}.stderr.log`;
    writeFileSync(stdoutPath, stdout);
    writeFileSync(stderrPath, stderr);
    writeSync(2, `[smoke-deb-command] full chroot output saved to ${stdoutPath} and ${stderrPath}\n`);
    for (const [label, output] of [["stdout", stdout], ["stderr", stderr]]) {
      const tail = output.split(/\r?\n/).slice(-120).join("\n");
      writeSync(2, `[smoke-deb-command] last 120 chroot ${label} lines:\n${tail}\n`);
    }
    const reason = error.status != null ? `exit ${error.status}` : error.signal ?? error.code ?? "unknown failure";
    throw new Error(`runner chroot command failed (${reason}); complete output is in the saved logs`);
  }
}

function createRunnerRootfs() {
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP);
  const workdir = mkdtempSync(path.join(runnerTemp, "omb-linux-smoke-deb-command-"));
  const root = path.join(workdir, "rootfs");
  const archive = path.join(workdir, "ubuntu-rootfs.tar");
  const container = `omb-linux-smoke-${process.pid}-${Date.now()}`;
  let containerExists = false;
  const procMounts = [];
  let keepRoot = false;

  const sudo = (args, options = {}) => execFileSync("sudo", ["-n", ...args], {
    stdio: "inherit",
    ...options,
  });
  try {
    mkdirSync(root);
    execFileSync("docker", ["create", "--name", container, IMAGE, "/bin/true"], { stdio: "inherit" });
    containerExists = true;
    execFileSync("docker", ["export", "--output", archive, container], { stdio: "inherit" });
    execFileSync("docker", ["rm", container], { stdio: "inherit" });
    containerExists = false;

    const resolver = path.join(workdir, "resolv.conf");
    writeFileSync(resolver, readFileSync("/etc/resolv.conf"));
    const extractRootfs = (destination) => {
      sudo(["install", "-d", "-m", "0755", destination]);
      sudo(["tar", "--numeric-owner", "--xattrs", "--xattrs-include=*", "-xpf", archive, "-C", destination]);
      sudo(["rm", "-f", path.join(destination, "etc/resolv.conf")]);
      sudo(["cp", "--", resolver, path.join(destination, "etc/resolv.conf")]);
    };
    extractRootfs(root);

    const createNullDevice = (destination) => {
      const dev = path.join(destination, "dev");
      sudo(["install", "-d", "-m", "0755", dev]);
      // Package scripts need only /dev/null. Never bind host devices.
      sudo(["rm", "-f", path.join(dev, "null")]);
      sudo(["mknod", "-m", "0666", path.join(dev, "null"), "c", "1", "3"]);
    };
    const mountReadOnlyProc = (destination) => {
      const proc = path.join(destination, "proc");
      sudo(["install", "-d", "-m", "0755", proc]);
      sudo(["mount", "-t", "proc", "-o", "ro,nosuid,nodev,noexec", "proc", proc]);
      procMounts.push(proc);
      const procOptions = execFileSync("findmnt", ["-n", "-o", "VFS-OPTIONS", "--target", proc], { encoding: "utf8" }).trim();
      if (!procOptions.split(",").includes("ro")) throw new Error(`fixture /proc mount is not read-only: ${procOptions}`);
      // This is the image-builder branch exercised by production postinst.
      sudo(["chroot", destination, "/usr/bin/ischroot"]);
    };
    createNullDevice(root);
    // Confirm the actual chroot boundary before running any package command.
    mountReadOnlyProc(root);
    return { root, workdir, archive, extractRootfs, mountReadOnlyProc, createNullDevice, container, cleanup: () => {
      let unmountError;
      for (const proc of [...procMounts].reverse()) {
        try {
          sudo(["umount", proc]);
          procMounts.splice(procMounts.indexOf(proc), 1);
        } catch (error) {
          keepRoot = true;
          unmountError ??= error;
        }
      }
      if (unmountError) throw new Error(`failed to unmount fixture /proc; preserving disposable rootfs at ${root}`, { cause: unmountError });
      if (!keepRoot) sudo(["rm", "-rf", "--", workdir]);
    }, cleanupContainer: () => {
      if (containerExists) {
        execFileSync("docker", ["rm", "-f", container], { stdio: "inherit" });
        containerExists = false;
      }
    } };
  } catch (error) {
    for (const proc of [...procMounts].reverse()) {
      try {
        sudo(["umount", proc]);
        procMounts.splice(procMounts.indexOf(proc), 1);
      } catch {
        keepRoot = true;
        writeSync(2, `[smoke-deb-command] failed to unmount fixture /proc; preserving ${root}\n`);
      }
    }
    if (containerExists) {
      try { execFileSync("docker", ["rm", "-f", container], { stdio: "inherit" }); } catch {}
    }
    if (!keepRoot) {
      try { sudo(["rm", "-rf", "--", workdir]); } catch {}
    }
    throw error;
  }
}

// Everything before the command under test is setup; `set -e` keeps a failed
// setup from being read as a failed install.
const prepare = [
  "set -e",
  "apt-get update -qq",
  "apt-get install -y -qq sudo >/dev/null",
  `printf '%s\\n' 'Dpkg::Use-Pty "0";' > /etc/apt/apt.conf.d/99-smoke-no-pty`,
  `mkdir -p "$(dirname "${staged}")"`,
  `cp /tmp/package.deb "${staged}"`,
].join("\n");

console.log("[smoke-deb-command] installing with the command the app hands over…");
let installed;
let control;
if (runnerChroot) {
  const fixture = createRunnerRootfs();
  try {
    const stagedPath = path.join(fixture.root, staged.slice(1));
    execFileSync("sudo", ["-n", "mkdir", "-p", path.dirname(stagedPath)], { stdio: "inherit" });
    execFileSync("sudo", ["-n", "cp", "--", deb, stagedPath], { stdio: "inherit" });
    const runnerPrepare = [
      "set -e",
      "apt-get update -qq",
      "apt-get install -y -qq sudo >/dev/null",
      `printf '%s\\n' 'Dpkg::Use-Pty "0";' > /etc/apt/apt.conf.d/99-smoke-no-pty`,
    ].join("\n");
    installed = inRunnerChroot(fixture.root, [
      runnerPrepare,
      command,
      'dpkg-query -W -f="INSTALLED=\\${Version} \\${db:Status-Abbrev}\\n" crewbot',
      'test -x /opt/crewbot/crewbot && echo "EXECUTABLE=yes"',
      'test -s /etc/apparmor.d/crewbot-browser && echo "APPARMOR_PROFILE=staged"',
    ].join("\n"));

    // A clean rootfs is required for the dependency-resolution control.
    const controlRoot = path.join(fixture.workdir, "control-rootfs");
    fixture.extractRootfs(controlRoot);
    fixture.createNullDevice(controlRoot);
    fixture.mountReadOnlyProc(controlRoot);
    const controlStagedPath = path.join(controlRoot, staged.slice(1));
    execFileSync("sudo", ["-n", "mkdir", "-p", path.dirname(controlStagedPath)], { stdio: "inherit" });
    execFileSync("sudo", ["-n", "cp", "--", deb, controlStagedPath], { stdio: "inherit" });
    console.log("[smoke-deb-command] control: the `dpkg -i` the app used to run…");
    control = inRunnerChroot(controlRoot, [
      "set -e",
      "apt-get update -qq",
      "apt-get install -y -qq sudo >/dev/null",
      `printf '%s\\n' 'Dpkg::Use-Pty "0";' > /etc/apt/apt.conf.d/99-smoke-no-pty`,
      `dpkg -i "${staged}" || echo "DPKG_FAILED"`,
    ].join("\n"));
  } finally {
    try {
      fixture.cleanupContainer();
    } finally {
      fixture.cleanup();
    }
  }
} else {
  installed = inContainer(
    [
      prepare,
      command,
      'dpkg-query -W -f="INSTALLED=\\${Version} \\${db:Status-Abbrev}\\n" crewbot',
      'test -x /opt/crewbot/crewbot && echo "EXECUTABLE=yes"',
      'test -s /etc/apparmor.d/crewbot-browser && echo "APPARMOR_PROFILE=staged"',
    ].join("\n"),
  );
  // The command this replaced. On a clean Ubuntu the dependencies are not
  // present, and dpkg resolves none of them — why the app must not run it.
  console.log("[smoke-deb-command] control: the `dpkg -i` the app used to run…");
  control = inContainer([prepare, `dpkg -i "${staged}" || echo "DPKG_FAILED"`].join("\n"));
}

const version = installed.match(/INSTALLED=(\S+) (\S+)/);
const checks = [
  ["the package installed and configured", version?.[2]?.startsWith("ii") === true],
  ["the app binary is in place", installed.includes("EXECUTABLE=yes")],
  ["the browser profile was staged in the image rootfs", installed.includes("APPARMOR_PROFILE=staged")],
];

// The command this replaced. On a clean Ubuntu the dependencies are not
// present, and dpkg resolves none of them — which is why the old in-app
// installer could leave a user with a broken package.
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
