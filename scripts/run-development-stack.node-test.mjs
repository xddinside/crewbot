import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const stackUrl = new URL("./run-development-stack.mjs", import.meta.url).href;

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail("fixture did not reach the expected state within 5 seconds");
}

function running(pid) {
  try {
    // An orphan killed by escalation may briefly await init's reaper.
    if (process.platform === "linux" && /State:\s+Z/.test(readFileSync(`/proc/${pid}/status`, "utf8"))) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes(error.code)) return false;
    throw error;
  }
}

for (const mode of ["SIGINT", "SIGTERM", "SIGHUP", "crash", "close", "spawn-error"]) {
  test(`stack cleans up owned grandchildren on ${mode}`, { skip: process.platform === "win32", timeout: 10000 }, async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "crewbot-stack-"));
    const pids = [];
    const leaf = path.join(dir, "leaf.mjs");
    const worker = path.join(dir, "worker.mjs");
    const runner = path.join(dir, "runner.mjs");
    writeFileSync(leaf, `import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], String(process.pid));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {});
setInterval(() => {}, 1000);
`);
    writeFileSync(worker, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, [${JSON.stringify(leaf)}, process.argv[2] + '.leaf']);
writeFileSync(process.argv[2], String(process.pid));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {});
if (process.argv[3] === 'crash' || process.argv[3] === 'close') {
  process.on('SIGUSR1', () => process.exit(process.argv[3] === 'crash' ? 7 : 0));
}
`);
    const commands = ["a", "b", "c"].map((name) => [process.execPath, worker, path.join(dir, name), name === "a" ? mode : "wait"]);
    if (mode === "spawn-error") commands.push([path.join(dir, "missing-command")]);
    writeFileSync(runner, `import { runDevelopmentStack } from ${JSON.stringify(stackUrl)};
runDevelopmentStack(${JSON.stringify(commands)}, { graceMs: 200 });
`);
    const child = spawn(process.execPath, [runner], { stdio: ["ignore", "pipe", "pipe"] });
    const closed = new Promise((resolve) => child.once("close", (code) => resolve(code)));
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    t.after(async () => {
      child.kill("SIGKILL");
      for (const pid of pids) { if (running(pid)) process.kill(pid, "SIGKILL"); }
      await closed;
      rmSync(dir, { recursive: true, force: true });
    });
    if (mode !== "spawn-error") {
      await until(() => {
        try {
          const ids = ["a", "b", "c"].flatMap((name) => [name, `${name}.leaf`]).map((name) => Number(readFileSync(path.join(dir, name), "utf8")));
          pids.splice(0, pids.length, ...ids);
          return true;
        } catch { return false; }
      });
      if (mode === "crash" || mode === "close") process.kill(pids[0], "SIGUSR1");
      else child.kill(mode);
    }
    assert.equal(await closed, mode === "crash" ? 7 : mode === "spawn-error" ? 1 : 0, stderr);
    await until(() => pids.every((pid) => !running(pid)));
    if (mode === "spawn-error") assert.match(stderr, /Could not start .*missing-command: spawn .* ENOENT/);
  });
}
