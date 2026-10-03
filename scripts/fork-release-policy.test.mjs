import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const release = readFileSync(fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)), "utf8");
const verify = readFileSync(fileURLToPath(new URL("../.github/workflows/sync-published-release.yml", import.meta.url)), "utf8");
const prepare = readFileSync(fileURLToPath(new URL("../.github/workflows/prepare-release.yml", import.meta.url)), "utf8");
const packageWin = readFileSync(fileURLToPath(new URL("../.github/workflows/package-win.yml", import.meta.url)), "utf8");

describe("fork release policy", () => {
  it("gates canonical jobs to the fork and leaves no upstream mirror in release workflows", () => {
    expect(release).toContain("if: github.repository == 'xddinside/crewbot'");
    expect(verify).toContain("if: github.repository == 'xddinside/crewbot'");
    for (const workflow of [release, verify, prepare, packageWin]) {
      expect(workflow).not.toMatch(/RELEASES_PAT|milind-soni\/openmausbot-releases/);
      expect(workflow).not.toMatch(/gh release (?:upload|create|edit).*--repo (?:milind-soni|OpenMausBot)/i);
    }
  });

  it("creates and verifies crewbot-v tags only", () => {
    expect(release).toContain('v="crewbot-v$(node -p');
    expect(release).toContain('tag="crewbot-v$VERSION"');
    expect(verify).toContain("^crewbot-v([0-9]+)");
    expect(verify).toContain("version=${TAG#crewbot-v}");
    expect(prepare).toContain('gh release view "crewbot-v$VERSION" --repo "$GITHUB_REPOSITORY"');
    expect(prepare).not.toMatch(/gh release view "v\$VERSION"/);
    expect(prepare).toContain('Bumps crewbot to');
  });

  it("checks that the standalone Windows installer updates from the fork", () => {
    expect(packageWin).toContain("grep -Eq '^owner: xddinside$'");
    expect(packageWin).toContain("grep -Eq '^repo: crewbot$'");
    expect(packageWin).toContain("app-update.yml does not point at xddinside/crewbot");
    expect(packageWin).not.toMatch(/\^repo: OpenMausBot\$|milind-soni\/OpenMausBot/);
  });
});
