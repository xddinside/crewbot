// Contracts for the installed candidate handoff: one packaging run in the
// current workflow run, feeding both installed jobs with the same six files and
// the producer's own record about them.
//
// These read workflow files as text and as parsed YAML. They never build a
// package, install one, or reach GitHub; what they hold honest is the shape of
// the handoff, so a future change cannot quietly go back to pinning a run in
// another run and its expiring artifact.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { LIVE_SESSION_VARIABLES } from "./installed-continuity/inputs.mjs";
import { ISOLATED_SESSION_KEYS } from "./installed-desktop-recovery/environment.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKFLOWS = join(ROOT, ".github", "workflows");
const read = (name) => readFileSync(join(WORKFLOWS, name), "utf8");
const load = (name) => parse(read(name));

const packager = read("package-linux.yml");
const continuity = read("linux-installed-continuity.yml");
const desktop = read("linux-desktop-recovery.yml");
const ci = read("ci.yml");

const DOWNLOAD_ARTIFACT = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";
const CONSUMERS = {
  "linux-installed-continuity.yml": continuity,
  "linux-desktop-recovery.yml": desktop,
};
/** The values that retired run and artifact: nothing may pin them again. */
const RETIRED = ["11215642565", "36982252699", "7fb1e45327d7e204cdcec681d96012f851976e13"];

describe("the packaging job is the one producer, and it is callable", () => {
  const doc = load("package-linux.yml");

  it("keeps the manual recipe and adds the reusable entry point", () => {
    expect(Object.keys(doc.on)).toEqual(["workflow_dispatch", "workflow_call"]);
    expect(doc.on.workflow_call.inputs.ref).toMatchObject({ required: false, type: "string" });
    expect(Object.keys(doc.on.workflow_call.outputs)).toEqual([
      "candidate-artifact",
      "candidate-manifest-artifact",
      "candidate-version",
      "candidate-source-sha",
    ]);
  });

  it("checks out the exact ref it is given, so a caller can pin the commit under review", () => {
    expect(packager).toMatch(/ref: \$\{\{ inputs\.ref \|\| github\.ref \}\}/);
  });

  it("uploads the six files and the record as two artifacts, never one", () => {
    // The record has to stay outside the six files: the release validator
    // rejects an artifact directory holding anything else, so a manifest riding
    // along inside the package artifact would make the artifact unusable.
    const uploads = load("package-linux.yml").jobs.package.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    const packageUpload = uploads.find((step) => String(step.with.path).includes("release-assets/*"));
    const recordUpload = uploads.find((step) => String(step.with.path).includes("candidate-handover/candidate-manifest.json"));
    expect(packageUpload).toBeTruthy();
    expect(recordUpload).toBeTruthy();
    expect(packageUpload.with["if-no-files-found"]).toBe("error");
    expect(recordUpload.with["if-no-files-found"]).toBe("error");
    // The record is small and its consumers copy it into their own evidence, so
    // it does not need the package's retention.
    expect(Number(recordUpload.with["retention-days"])).toBeLessThan(Number(packageUpload.with["retention-days"]));
  });

  it("names the artifacts from the module that owns the naming, not from a repeated string", () => {
    expect(packager).toContain("scripts/linux-candidate-manifest.mjs write");
    expect(packager).toMatch(/artifact-name=\$manifest_artifact/);
    expect(doc.jobs.package.outputs["manifest-artifact-name"]).toBe("${{ steps.handover.outputs.artifact-name }}");
    expect(doc.jobs.package.outputs["source-sha"]).toBe("${{ steps.handover.outputs.source-sha }}");
  });

  it("records the commit it actually built and refuses a requested commit it did not get", () => {
    expect(packager).toContain('source_sha="$(git rev-parse HEAD)"');
    expect(packager).toContain('[ "$source_sha" != "$REQUESTED_REF" ]');
    // A dispatched ref is user input, so it arrives through the environment
    // rather than being interpolated into the script.
    expect(packager).toMatch(/REQUESTED_REF: \$\{\{ inputs\.ref \}\}/);
  });

  it("pins every action it uses to a commit", () => {
    for (const step of doc.jobs.package.steps) {
      if (!step.uses) continue;
      expect(step.uses, `${step.uses} must be pinned`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("one producer, two consumers, one current run", () => {
  const doc = load("linux-installed-acceptance.yml");

  it("runs before merge, so the installed proofs stay deliverable", () => {
    expect(Object.keys(doc.on)).toEqual(["workflow_dispatch", "push", "pull_request"]);
  });

  it("builds the candidate at this workflow's own commit", () => {
    expect(doc.jobs.package.uses).toBe("./.github/workflows/package-linux.yml");
    expect(doc.jobs.package.with.ref).toBe("${{ github.sha }}");
  });

  it("hands both consumers the same artifact, the same record, and its own commit", () => {
    for (const job of ["installed-continuity", "installed-desktop-recovery"]) {
      expect(doc.jobs[job].needs).toBe("package");
      expect(doc.jobs[job].uses).toBe(`./.github/workflows/${job === "installed-continuity" ? "linux-installed-continuity.yml" : "linux-desktop-recovery.yml"}`);
      // The expected source SHA is this workflow's own checkout. Reading it back
      // from the producer's record would let the record vouch for itself.
      expect(doc.jobs[job].with["candidate-source-sha"]).toBe("${{ github.sha }}");
      expect(doc.jobs[job].with["candidate-version"]).toBe("${{ needs.package.outputs.candidate-version }}");
      expect(doc.jobs[job].with["candidate-artifact"]).toBe("${{ needs.package.outputs.candidate-artifact }}");
      expect(doc.jobs[job].with["candidate-manifest-artifact"]).toBe("${{ needs.package.outputs.candidate-manifest-artifact }}");
    }
  });

  it("asks for contents and nothing else", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
  });
});

describe.each(Object.entries(CONSUMERS))("%s", (name, text) => {
  const doc = load(name);
  const fixtureCommand = name.includes("continuity")
    ? "scripts/verify-linux-installed-continuity.mjs"
    : "scripts/verify-installed-desktop-recovery.mjs";

  it("is called by the wrapper rather than triggered on its own", () => {
    // A dispatched consumer would have no producer, so the artifact name would
    // have to be pinned by hand again — which is the dependency being removed.
    expect(Object.keys(doc.on)).toEqual(["workflow_call"]);
    expect(Object.keys(doc.on.workflow_call.inputs)).toEqual([
      "candidate-source-sha",
      "candidate-version",
      "candidate-artifact",
      "candidate-manifest-artifact",
    ]);
    for (const input of Object.values(doc.on.workflow_call.inputs)) {
      expect(input.required).toBe(true);
      expect(input.type).toBe("string");
    }
  });

  it("downloads both halves of the handover from this run, with no cross-run permission", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(text).toContain(DOWNLOAD_ARTIFACT);
    expect(text).toContain("${{ inputs.candidate-artifact }}");
    expect(text).toContain("${{ inputs.candidate-manifest-artifact }}");
    // The record lands in its own directory: a record written into the candidate
    // directory would be a seventh file and fail the release validator.
    expect(text).toMatch(/inputs\/handover$/m);
    expect(text).not.toContain("gh run download");
  });

  it("checks its checkout and the record before the fixture installs anything", () => {
    expect(text).toContain("scripts/linux-candidate-manifest.mjs check");
    expect(text).toMatch(/test "\$\(git rev-parse HEAD\)" = "\$CANDIDATE_SOURCE_SHA"/);
    expect(text).toContain('--source-sha "$CANDIDATE_SOURCE_SHA"');
    expect(text).toContain('--version "$CANDIDATE_VERSION"');
    // The step order matters: the check cannot come after the fixture.
    expect(text.indexOf("linux-candidate-manifest.mjs check"))
      .toBeLessThan(text.indexOf(fixtureCommand));
    expect(text.indexOf("actions/download-artifact"))
      .toBeLessThan(text.indexOf("linux-candidate-manifest.mjs check"));
  });

  it("keeps its own native surface: runner, session clearing, and its evidence name", () => {
    expect(text).toContain("runs-on: ubuntu-24.04");
    const job = Object.values(doc.jobs)[0];
    const cleared = job.env ?? {};
    const expected = name.includes("continuity") ? LIVE_SESSION_VARIABLES : ISOLATED_SESSION_KEYS;
    for (const key of expected) expect(cleared[key], `${name} must clear ${key}`).toBe("");
    expect(text).toContain(name.includes("continuity") ? "linux-installed-continuity-evidence" : "linux-desktop-recovery-evidence");
    expect(text).toContain("inputs/handover/candidate-manifest.json");
  });
});

describe("the desktop journey keeps its own teardown contract", () => {
  it("still fails on a survivor and still reads absence from dpkg", () => {
    const cleanup = desktop.slice(desktop.indexOf("- name: Remove the installed package"));
    expect(cleanup).toContain("package_absence_problem()");
    expect(cleanup).toMatch(/\$\{status:1:1\}" = "n"/);
    expect(cleanup).toContain("exit 1");
    expect(cleanup).not.toContain("::warning::");
    expect(cleanup).toContain("[ -e /opt/crewbot ]");
  });

  it("still drives the real installed package, not an unpacked build", () => {
    expect(desktop).toContain("run: node scripts/verify-installed-desktop-recovery.mjs");
    expect(desktop).toContain("OMB_RECOVERY_CANDIDATE_SHA: ${{ inputs.candidate-source-sha }}");
  });
});

describe("standard CI and the parked platforms stay independent", () => {
  it("leaves the aggregate CI package job alone", () => {
    // `ci.yml` builds its own package and must keep doing so: the installed
    // acceptance run is an extra proof, not a dependency of the required gate.
    expect(ci).toContain("package-linux:");
    expect(ci).not.toContain("uses: ./.github/workflows/package-linux.yml");
    expect(ci).not.toContain("linux-candidate-manifest");
  });

  it("pins no retired artifact, run or source anywhere in the workflows", () => {
    for (const file of readdirSync(WORKFLOWS)) {
      const text = readFileSync(join(WORKFLOWS, file), "utf8");
      for (const retired of RETIRED) {
        expect(text, `${file} must not name ${retired}`).not.toContain(retired);
      }
      if (file === "package-linux.yml" || CONSUMERS[file] || file === "linux-installed-acceptance.yml") continue;
      expect(text, `${file} must not fetch a candidate from another run`).not.toContain("gh run download");
    }
  });

  it("keeps every handover artifact name identical across producer and consumers", () => {
    // The wrapper passes names rather than repeating them, so a rename cannot
    // half-happen: the consumer's input is the producer's output.
    for (const job of Object.values(load("linux-installed-acceptance.yml").jobs)) {
      if (!job.with?.["candidate-artifact"]) continue;
      expect(job.with["candidate-artifact"]).toContain("needs.package.outputs");
      expect(job.with["candidate-manifest-artifact"]).toContain("needs.package.outputs");
    }
  });
});