import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Own each command's process group, including grandchildren of pnpm/sh.
 * Any child exit ends the stack. Escalation remains armed even after a group
 * leader exits, since its descendants may still be alive.
 */
export function runDevelopmentStack(commands, { env = process.env, cwd = process.cwd(), graceMs = 3000 } = {}) {
  const children = [];
  let stopping = false;
  let deadline;
  const grouped = process.platform !== "win32";

  function signalChild(child, signal) {
    if (!child.pid) return;
    try {
      if (grouped) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  function groupAlive(child) {
    if (!grouped) return child.exitCode === null && child.signalCode === null;
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  }

  function finishIfStopped() {
    if (stopping && children.every((child) => !groupAlive(child))) clearTimeout(deadline);
  }

  function stop(code, signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) signalChild(child, signal);
    deadline = setTimeout(() => {
      for (const child of children) signalChild(child, "SIGKILL");
    }, graceMs);
    finishIfStopped();
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => stop(0, signal));
  }
  for (const [command, ...args] of commands) {
    if (stopping) break;
    const child = spawn(command, args, { cwd, env, stdio: "inherit", detached: grouped, shell: false });
    children.push(child);
    child.once("error", (error) => {
      process.stderr.write(`Could not start ${command}: ${error.message}\n`);
      stop(1);
    });
    child.once("exit", (code, signal) => {
      if (!stopping) stop(code ?? (signal ? 1 : 0));
      finishIfStopped();
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDevelopmentStack(["dev:server", "dev", "dev:desktop"].map((command) => ["pnpm", command]));
}
