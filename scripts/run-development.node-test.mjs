import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";

test("development commands isolate data, profile, cache, ports and stable service ownership", async () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /portless run --name crewbot vite/);
  const script = new URL("./run-development.mjs", import.meta.url);
  const probe = `process.stdout.write(JSON.stringify({\n` +
    `data: process.env.CREWBOT_DATA_DIR,\n` +
    `profile: process.env.CREWBOT_DEV_PROFILE_DIR,\n` +
    `stableProfile: process.env.CREWBOT_PROFILE_DIR,\n` +
    `cache: process.env.XDG_CACHE_HOME,\n` +
    `port: process.env.CREWBOT_PORT,\n` +
`webhookPort: process.env.CREWBOT_WEBHOOK_PORT,\n` +
    `startUrl: process.env.ELECTRON_START_URL,\n` +
    `development: process.env.CREWBOT_DEV_LAUNCH,\n` +
    `portless: process.env.PORTLESS,\n` +
    `legacyData: process.env.OMB_DATA_DIR\n` +
    `}));`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script.pathname, process.execPath, "-e", probe], {
      env: {
        ...process.env,
        CREWBOT_DATA_DIR: "/stable/data",
        CREWBOT_PROFILE_DIR: "/stable/profile",
        OMB_DATA_DIR: "/stable/legacy-data",
        PORTLESS: "0",
        PORTLESS_PORT: "1355",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  const worktreeCount = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length;
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const branchName = branch.split("/").at(-1) ?? "";
  const worktree = worktreeCount > 1 && !["", "HEAD", "main", "master"].includes(branch)
    ? branchName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
    : "";
  const suffix = worktree ? `-${worktree}` : "";
  assert.equal(value.data, path.join(homedir(), `.crewbot-development${suffix}`));
  const profileParts = value.profile.split(/[\\/]/);
  assert.equal(profileParts.at(-1), worktree || "crewbot-development");
  if (worktree) assert.equal(profileParts.at(-2), "crewbot-development");
  assert.equal(value.stableProfile, undefined);
  assert.equal(value.cache, path.join(homedir(), ".cache", `crewbot-development${suffix}`));
  assert.equal(value.startUrl, `https://${worktree ? `${worktree}.` : ""}crewbot.localhost:1355`);
  if (worktree) {
    assert.notEqual(value.port, "18799");
    assert.notEqual(value.webhookPort, "18800");
  } else {
    assert.equal(value.port, "18799");
    assert.equal(value.webhookPort, "18800");
  }
  assert.equal(value.development, "1");
  assert.equal(value.portless, "1");
  assert.equal(value.legacyData, undefined);
});
