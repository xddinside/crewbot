// Vitest globalSetup — runs once in the main process, before any worker or test
// file is loaded, and in the same environment the developer (or CI) invoked.
//
// server/testing/setup.ts already clears CREWBOT_DATA_DIR and OMB_DATA_DIR per
// worker. This is the layer above it. setup.ts only runs for test files that go
// through vite.config.ts, so a run that bypasses that config never reached the
// per-worker guard — and on 2026-09-29 that gap cost a real data directory.
// Failing here, with nothing started, is the cheapest place to catch it.

import { assertNoLiveDataDirOverride } from "./data-dir-guard.ts";

assertNoLiveDataDirOverride(process.env);
