import { spawn } from "node:child_process";

const commands = ["dev:server", "dev", "dev:desktop"];
const children = [];
let stopping = false;

for (const command of commands) {
  const child = spawn("pnpm", [command], { stdio: "inherit", env: process.env });
  children.push(child);
  child.once("error", (error) => {
    process.stderr.write(`Could not start pnpm ${command}: ${error.message}\n`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    if (code !== 0 || signal) stop(code ?? 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => stop(0, signal));
}

function stop(code, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}
