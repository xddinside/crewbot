import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("desktop and iOS register both pairing schemes while issuers retain legacy output", () => {
  const desktopManifest = read("electron-builder.yml");
  const desktopEntry = read("electron/main.mjs");
  const iosManifest = read("ios/project.yml");
  const iosParser = read("ios/Sources/CompanionCore/Client.swift");

  assert.match(desktopManifest, /^appId: com\.openmausbot\.app/m);
  assert.match(desktopManifest, /schemes: \[crewbot\]/);
  assert.match(desktopManifest, /schemes: \[openmausbot\]/);
  assert.match(desktopEntry, /setAsDefaultProtocolClient\("crewbot"\)/);
  assert.match(desktopEntry, /setAsDefaultProtocolClient\("openmausbot"\)/);
  const iosUrlTypes = iosManifest.match(/CFBundleURLTypes:[\s\S]*?(?=\n\s{8}\S|$)/)?.[0] ?? "";
  const iosRegisteredSchemes = [...iosUrlTypes.matchAll(/^\s+- (openmausbot|crewbot)$/gm)].map((match) => match[1]);
  assert.deepEqual(new Set(iosRegisteredSchemes), new Set(["openmausbot", "crewbot"]));
  assert.match(iosParser, /\["openmausbot", "crewbot"\]/);
  assert.match(read("src/lib/companion-pairing.ts"), /new URL\("openmausbot:\/\/pair"\)/);
  assert.match(read("server/cli.ts"), /`openmausbot:\/\/pair\?/);
  assert.match(read("server/index.ts"), /`openmausbot:\/\/pair\?/);
});
