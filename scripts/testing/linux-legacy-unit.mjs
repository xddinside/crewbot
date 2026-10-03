// Render the ACTUAL legacy OpenMausBot systemd unit, not an imitation of it.
//
// The legacy unit contract is whatever the released CLI wrote before the
// product was renamed. This repository still carries that renderer: commit
// `d57f49a3` is the rename, so its parent holds the pre-rename
// `server/service-unit.ts`. That file imports only `node:os` and `node:path`,
// which makes it runnable standalone.
//
// The fixture recovers that exact file out of the local object store, checks it
// is the module the pinned revision claims (unit name, description, and the
// single `OMB_DATA_DIR` assignment), and executes it. A hand-written fixture
// unit would prove nothing about the contract this rollback code parses.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { fail, sha256 } from "./linux-service-fixture.mjs";

/** The rename commit. Its parent is the last revision that wrote the legacy unit. */
export const LEGACY_RENDERER_REVISION = "d57f49a3";

export function legacyRendererSource(repoRoot) {
  const result = spawnSync("git", ["-C", repoRoot, "cat-file", "-p", `${LEGACY_RENDERER_REVISION}^:server/service-unit.ts`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `could not read the historical legacy unit renderer from ${LEGACY_RENDERER_REVISION}^:server/service-unit.ts ` +
      `(git exited ${result.status}). This job checks out full history on purpose: a legacy-unit proof that used a ` +
      `hand-written unit file would not establish the real contract.\n${result.stderr}`,
    );
  }
  const source = result.stdout;
  for (const required of [
    'export const SYSTEMD_UNIT_NAME = "openmausbot.service"',
    "Description=OpenMausBot",
    "Environment=OMB_DATA_DIR=",
    "export function systemdUnit(",
  ]) {
    if (!source.includes(required)) {
      fail(`the recovered legacy renderer at ${LEGACY_RENDERER_REVISION}^ does not contain ${JSON.stringify(required)}; refusing to call it the legacy contract`);
    }
  }
  if (source.includes("CREWBOT_DATA_DIR=")) fail("the recovered renderer already knows Crewbot, so it is not the legacy unit contract");
  return source;
}

/** Execute the recovered historical module and return the unit it renders. */
export function renderLegacySystemdUnit(spec, { repoRoot }) {
  const source = legacyRendererSource(repoRoot);
  const staging = mkdtempSync(join(tmpdir(), "omb-legacy-unit-"));
  const module = join(staging, "legacy-service-unit.ts");
  const entry = join(staging, "render-legacy-unit.mjs");
  writeFileSync(module, source, { mode: 0o600 });
  writeFileSync(entry, [
    `import { systemdUnit, SYSTEMD_UNIT_NAME } from ${JSON.stringify(pathToFileURL(module).href)};`,
    `process.stdout.write(JSON.stringify({ unitName: SYSTEMD_UNIT_NAME, unit: systemdUnit(JSON.parse(process.argv[2])) }));`,
    "",
  ].join("\n"), { mode: 0o600 });

  const result = spawnSync(process.execPath, ["--experimental-strip-types", entry, JSON.stringify(spec)], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`the recovered legacy renderer failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const rendered = JSON.parse(result.stdout);
  if (rendered.unitName !== "openmausbot.service") {
    fail(`the recovered legacy renderer claims unit name ${rendered.unitName}, not openmausbot.service`);
  }
  if (dirname(spec.dataDir) === undefined) fail("the legacy unit spec needs a data directory");
  const expected = `Environment=OMB_DATA_DIR=${spec.dataDir}`;
  if (!rendered.unit.split("\n").includes(expected)) {
    fail(`the recovered legacy renderer did not declare ${expected}`);
  }
  return { ...rendered, rendererSha256: sha256(source) };
}

/** Print the provenance of the legacy unit for the report and the log. */
export function legacyUnitProvenance(repoRoot) {
  const commit = execFileSync("git", ["-C", repoRoot, "rev-parse", `${LEGACY_RENDERER_REVISION}^`], { encoding: "utf8" }).trim();
  const subject = execFileSync("git", ["-C", repoRoot, "log", "-1", "--format=%s", commit], { encoding: "utf8" }).trim();
  return { rendererRevision: commit, rendererSubject: subject };
}
