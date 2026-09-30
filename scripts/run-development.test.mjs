import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  assert.equal(value.data, path.join(homedir(), ".crewbot-development-crewbot-pr8-review-fixes"));
  assert.match(value.profile, /crewbot-development[/\\]crewbot-pr8-review-fixes$/);
  assert.equal(value.stableProfile, undefined);
  assert.match(value.cache, /crewbot-development-crewbot-pr8-review-fixes$/);
  assert.match(value.startUrl, /^https:\/\/crewbot-pr8-review-fixes\.crewbot\.localhost:1355$/);
  assert.notEqual(value.port, "18799");
  assert.notEqual(value.webhookPort, "18800");
  assert.equal(value.development, "1");
  assert.equal(value.portless, "1");
  assert.equal(value.legacyData, undefined);
});
