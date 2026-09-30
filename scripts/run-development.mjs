import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const home = homedir();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const appData = process.env.APPDATA || (process.platform === "darwin"
  ? path.join(home, "Library", "Application Support")
  : process.env.XDG_CONFIG_HOME || path.join(home, ".config"));
const worktreePrefix = getWorktreePrefix();
const worktreeSuffix = worktreePrefix ? `-${worktreePrefix}` : "";
const dataDir = path.resolve(process.env.CREWBOT_DEV_DATA_DIR || path.join(home, `.crewbot-development${worktreeSuffix}`));
const profileDir = path.resolve(process.env.CREWBOT_DEV_PROFILE_DIR || path.join(appData, `crewbot-development${worktreePrefix ? path.sep + worktreePrefix : ""}`));
const cacheDir = path.resolve(process.env.CREWBOT_DEV_CACHE_DIR || path.join(home, ".cache", `crewbot-development${worktreeSuffix}`));
const portOffset = worktreePrefix ? Number.parseInt(createHash("sha256").update(worktreePrefix).digest("hex").slice(0, 4), 16) % 1000 : 0;
const serverPort = process.env.CREWBOT_DEV_PORT || String(worktreePrefix ? 18000 + portOffset : 18799);
const webhookPort = process.env.CREWBOT_DEV_WEBHOOK_PORT || String(worktreePrefix ? 19000 + portOffset : 18800);
const proxyPort = process.env.PORTLESS_PORT?.trim();
const startUrl = process.env.CREWBOT_DEV_START_URL || `https://${worktreePrefix ? `${worktreePrefix}.` : ""}crewbot.localhost${proxyPort ? `:${proxyPort}` : ""}`;
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  process.stderr.write("Usage: node scripts/run-development.mjs <command> [args...]\n");
  process.exit(2);
}

const env = {
  ...process.env,
  CREWBOT_DEV_LAUNCH: "1",
  CREWBOT_DEV_DATA_DIR: dataDir,
  CREWBOT_DATA_DIR: dataDir,
  CREWBOT_DEV_PROFILE_DIR: profileDir,
  CREWBOT_DEV_START_URL: startUrl,
  CREWBOT_PORT: serverPort,
  CREWBOT_WEBHOOK_PORT: webhookPort,
  OMB_PORT: serverPort,
  OMB_WEBHOOK_PORT: webhookPort,
  XDG_CACHE_HOME: cacheDir,
  PORTLESS: "1",
  ELECTRON_START_URL: startUrl,
};
delete env.OMB_DATA_DIR;
delete env.OMB_PROFILE_DIR;
delete env.CREWBOT_PROFILE_DIR;

const launch = resolveCommand(command, args);
const child = spawn(launch.command, launch.args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill(signal);
  });
}
child.once("error", (error) => {
  process.stderr.write(`Could not start ${command}: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

function resolveCommand(name, commandArgs) {
  if (name === "node") return { command: process.execPath, args: commandArgs };
  if (name === "electron") return { command: require("electron"), args: commandArgs };
  if (name === "portless") {
    const cli = path.join(root, "node_modules", "portless", "dist", "cli.js");
    return { command: process.execPath, args: [cli, ...commandArgs] };
  }
  return { command: name, args: commandArgs };
}

function getWorktreePrefix() {
  try {
    const cwd = process.cwd();
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (worktrees.split("\n").filter((line) => line.startsWith("worktree ")).length <= 1) return "";
    const gitDir = path.resolve(cwd, execFileSync("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
    const commonDir = path.resolve(cwd, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
    if (gitDir === commonDir) return "";
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!branch || branch === "HEAD" || branch === "main" || branch === "master") return "";
    const lastSegment = branch.split("/").pop();
    const sanitized = lastSegment.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    if (sanitized.length <= 63) return sanitized;
    const suffix = createHash("sha256").update(sanitized).digest("hex").slice(0, 6);
    return `${sanitized.slice(0, 56).replace(/-+$/, "")}-${suffix}`;
  } catch {
    return "";
  }
}
