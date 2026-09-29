// A test run must never resolve to a real user's data directory.
//
// On 2026-09-29 a suite run on a developer machine inherited
// CREWBOT_DATA_DIR=/home/xdd/.crewbot from the shell. A fixture that cleans its
// data directory then deleted the live one out from under a running server, and
// two days of room history went with it. Deleting the env vars in setup.ts
// prevents the known path, but it depends on setup.ts loading before any test
// module, on the redirect actually taking effect, and on nobody running vitest
// through some other entry point. Those are three assumptions held in place by
// ordering rather than by construction.
//
// So the rule is enforced, not remembered: these helpers take the resolved data
// directory and the real home, and refuse anything that points at a live dir.
// They are pure — no imports from server/config.ts, which resolves DATA_DIR at
// import time and would bind this module to the wrong home.

import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/** Data dir override names, in the precedence order server/config.ts reads them. */
export const DATA_DIR_ENV_VARS = ["CREWBOT_DATA_DIR", "OMB_DATA_DIR"] as const;

/** Directory names a live install uses under its home. */
const LIVE_DATA_DIR_NAMES = [".crewbot", ".openmausbot"] as const;

/**
 * The data dir server/config.ts would resolve, given an environment and a home.
 *
 * Mirrors config.ts:733-734 deliberately rather than importing it. config.ts
 * resolves DATA_DIR at import time, so importing it from a test helper binds the
 * value to whichever home was current at that moment instead of the throwaway
 * one this module is asked about. If config.ts ever changes this precedence,
 * this function must change with it — there is a test asserting the two agree.
 */
export function resolveDataDir(
  env: Record<string, string | undefined>,
  home: string,
): string {
  for (const name of DATA_DIR_ENV_VARS) {
    const override = env[name]?.trim();
    if (override) return resolve(override);
  }
  return join(home, ".crewbot");
}

/** Every path this guard treats as a live, untouchable data directory. */
export function liveDataDirs(realHome: string): string[] {
  return LIVE_DATA_DIR_NAMES.map((name) => resolve(join(realHome, name)));
}

export class DataDirIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirIsolationError";
  }
}

/** True when `child` is `parent` or sits underneath it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Refuse a data directory that could destroy a real install.
 *
 * Two ways to be unsafe, both seen in practice: the override names a live dir
 * outright, or the throwaway-home redirect silently failed and the default
 * `~/.crewbot` resolved against the real home.
 *
 * @param dataDir    the data dir the suite is about to use
 * @param throwawayHome the home the suite intends to resolve against
 * @param realHome   the invoking user's real home, captured before any redirect
 */
export function assertDataDirIsolated(
  dataDir: string,
  throwawayHome: string,
  realHome: string,
): void {
  const target = resolve(dataDir);
  const live = liveDataDirs(realHome);

  const liveMatch = live.find((dir) => target === dir);
  if (liveMatch) {
    throw new DataDirIsolationError(
      `refusing to run: the suite resolved the data dir to the live ${liveMatch}\n` +
        `Unset ${DATA_DIR_ENV_VARS.join(" and ")} for this shell, or point them at a\n` +
        `throwaway directory. A test run that cleans its data dir deletes this one with it.`,
    );
  }

  if (!isInside(throwawayHome, target)) {
    throw new DataDirIsolationError(
      `refusing to run: data dir ${target} is outside the throwaway home ${resolve(throwawayHome)}\n` +
        `The home redirect did not take effect, so the suite would fall back to a real\n` +
        `home's default data dir.`,
    );
  }
}

/**
 * Pre-flight for the vitest main process, before any worker or test file starts.
 *
 * Catches a stray shell export even if the per-worker guard never runs, which is
 * the case when vitest is invoked through an entry point that skips setupFiles.
 */
export function assertNoLiveDataDirOverride(
  env: Record<string, string | undefined>,
  realHome: string = homedir(),
): void {
  const live = liveDataDirs(realHome);
  for (const name of DATA_DIR_ENV_VARS) {
    const override = env[name]?.trim();
    if (!override) continue;
    const target = resolve(override);
    if (live.includes(target)) {
      throw new DataDirIsolationError(
        `${name}=${target} points at a live data directory.\n` +
          `Unset it before running tests, or point it at a throwaway directory.`,
      );
    }
  }
}
