// Launch a real installed Electron package and observe what only that process
// can show: which desktop profile it adopted, which data directory it leased,
// which keyring identity it decrypted, and what it handed its own server child.
//
// The desktop owner capability is deliberately unreachable from outside, so
// this module never tries to impersonate the window. It reads the two channels
// that are real production effects and are observable from another process of
// the same user: the app's own log file and the child's inherited environment.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function running(handle) {
  return handle.exitCode === null && handle.signalCode === null;
}

/** Chromium's password store is chosen per launch. Naming the OS backend
 * explicitly is what makes the credential claim checkable: the same switch is
 * used on both sides of the upgrade, so continuity is not an accident of
 * auto-detection, and `basic_text` cannot be selected by accident.
 *
 * Overridable only so a Chromium that rejects the value can be retried without
 * editing the fixture; the recorded value is part of the evidence. */
export function passwordStoreArgs(env = process.env) {
  const backend = (env.OMB_CONTINUITY_PASSWORD_STORE ?? "gnome_libsecret").trim();
  if (!/^[a-z0-9_]+$/.test(backend)) throw new Error(`invalid password-store backend: ${backend}`);
  return [`--password-store=${backend}`];
}

export function readProcessEnviron(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** Every live process whose inherited environment names this data directory is
 * a child of the app we launched: the utility server sets both the modern and
 * the legacy variable to the same resolved path. */
export function findOwnedServerChildren({ dataDir, exclude = [] }) {
  const owned = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (exclude.includes(pid)) continue;
    const environ = readProcessEnviron(pid);
    if (!environ.length) continue;
    const matches = environ.some((entry) => entry === `CREWBOT_DATA_DIR=${dataDir}` || entry === `OMB_DATA_DIR=${dataDir}`);
    if (!matches) continue;
    let cmdline = "";
    try { cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); }
    catch { continue; }
    owned.push({ pid, cmdline, environ });
  }
  return owned;
}

/** Wait for one variable to appear in a spawned child's inherited environment.
 * The app writes its credentials before it starts the server, so a short,
 * bounded window is enough; the miss is reported rather than papered over. */
export async function waitForChildEnvVariable({ child, dataDir, variable, timeoutMs = 60_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const found of findOwnedServerChildren({ dataDir, exclude: [child.pid] })) {
      const hit = found.environ.find((entry) => entry.startsWith(`${variable}=`));
      if (hit) return { pid: found.pid, value: hit.slice(variable.length + 1), cmdline: found.cmdline };
    }
    if (!running(child)) return null;
    await delay(250);
  }
  return null;
}

/**
 * Run one installed app to completion and return everything it left behind.
 *
 * The desktop smoke hook is used because it is the packaged product's own
 * boot-to-close path: it proves the renderer and the embedded server really
 * loaded. Renderer readiness is recorded, not required, because the boot
 * effects this fixture depends on (profile selection, data-directory
 * migration, credential migration) happen before the window exists.
 *
 * @param options.executable - The installed binary from the package.
 * @param options.env - Only the fixture's own session values.
 * @param options.profileDir - The directory the app resolved as its profile.
 * @param options.dataDir - The workspace the app leased.
 * @param options.expectEnv - Variable whose value proves decrypt-and-use.
 * @returns Exit status, captured output, and located production effects.
 */
export async function runInstalledApp({
  executable,
  env,
  args = [],
  storeArgs = passwordStoreArgs(),
  profileDir,
  dataDir,
  expectEnv,
  timeoutMs = 180_000,
  log,
}) {
  // Its own process group: the app forks a server and a Cua driver, and a
  // teardown that only reached the launcher would leave them running.
  const child = spawn(executable, [...args, ...storeArgs], {
    cwd: "/",
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.length > 512_000) output = output.slice(-256_000);
    });
  }

  let serverEnv = null;
  let serverPid = null;
  let rendererReady = false;
  let leaseHeld = false;
  const deadline = Date.now() + timeoutMs;
  while (running(child) && Date.now() < deadline) {
    if (!rendererReady && output.includes("[smoke] renderer-ready ")) rendererReady = true;
    if (expectEnv && !serverEnv) {
      const hit = await waitForChildEnvVariable({ child, dataDir, variable: expectEnv, timeoutMs: 1_000 });
      if (hit) { serverEnv = hit.value; serverPid = hit.pid; }
    }
    try {
      readFileSync(join(dataDir, "openmausbot-server.lease"));
      leaseHeld = true;
    } catch { /* not leased yet, or already released */ }
    await delay(200);
  }
  if (running(child)) {
    log?.(`[installed] ${executable} did not exit within ${timeoutMs}ms; terminating the owned process group`);
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    const grace = Date.now() + 10_000;
    while (running(child) && Date.now() < grace) await delay(100);
    if (running(child)) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
  await closed;

  return {
    executable,
    storeArgs,
    exitCode: child.exitCode,
    signal: child.signalCode,
    timedOut: child.exitCode === null && child.signalCode === null,
    rendererReady,
    serverEnv,
    serverPid,
    leaseHeld,
    serverLog: readTextIfPresent(join(profileDir, "logs", "server.log")),
    output,
  };
}

function readTextIfPresent(path) {
  try { return readFileSync(path, "utf8"); }
  catch { return null; }
}