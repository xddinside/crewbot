import { describe, expect, it } from "vitest";

import { countsLine, parseArguments, parseChecks, printOpening, printVerdict, stateChanges, summarize } from "./ci-wait.mjs";

const threeChecks = JSON.stringify([
  { name: "typecheck + lint", bucket: "pass", link: "https://example.test/1" },
  { name: "vitest (ubuntu, shard 2/4)", bucket: "pending", link: "https://example.test/2" },
  { name: "packaged server smoke (ubuntu)", bucket: "skipping", link: null },
]);

const withShardFailed = JSON.stringify([
  { name: "typecheck + lint", bucket: "pass", link: "https://example.test/1" },
  { name: "vitest (ubuntu, shard 2/4)", bucket: "fail", link: "https://example.test/2" },
  { name: "packaged server smoke (ubuntu)", bucket: "skipping", link: null },
]);

describe("ci-wait.mjs arguments", () => {
  it("defaults to the current branch on a 30 second cadence", () => {
    const options = parseArguments([]);
    expect(options.prs).toEqual([]);
    expect(options.interval).toBe(30);
    expect(options.timeout).toBe(60);
    expect(options.required).toBe(false);
  });

  it("reads a stack of pull requests", () => {
    expect(parseArguments(["812", "813"]).prs).toEqual([812, 813]);
  });

  it("refuses a cadence faster than five seconds", () => {
    expect(() => parseArguments(["--interval", "1"])).toThrow(/at least 5 seconds/);
    expect(() => parseArguments(["--interval", "abc"])).toThrow(/at least 5 seconds/);
    expect(() => parseArguments(["--timeout", "0"])).toThrow(/positive number of minutes/);
    expect(() => parseArguments(["812", "--verbose"])).toThrow(/unknown argument: --verbose/);
  });
});

describe("ci-wait.mjs check state", () => {
  it("reads gh's buckets and holds an unknown one as pending", () => {
    expect(parseChecks(threeChecks)?.map((check) => check.bucket)).toEqual(["pass", "pending", "skipping"]);
    expect(parseChecks(JSON.stringify([{ name: "odd", bucket: "weird" }]))?.[0].bucket).toBe("pending");
  });

  it("reports unreadable output rather than guessing at it", () => {
    expect(parseChecks("")).toBeNull();
    expect(parseChecks("{}")).toBeNull();
  });

  it("reports only what moved, so an unchanged poll says nothing", () => {
    const first = parseChecks(threeChecks);
    expect(stateChanges(undefined, first)).toHaveLength(3);
    expect(stateChanges(first, parseChecks(threeChecks))).toEqual([]);
    expect(stateChanges(first, parseChecks(withShardFailed))).toEqual([
      { name: "vitest (ubuntu, shard 2/4)", bucket: "fail", link: "https://example.test/2" },
    ]);
  });

  it("separates a red run from a run that is still going", () => {
    const waiting = summarize(parseChecks(threeChecks));
    expect(waiting.counts).toMatchObject({ pass: 1, fail: 0, pending: 1, skipping: 1 });
    expect(waiting.pending).toBe(true);
    expect(waiting.failed).toBe(false);

    const red = summarize(parseChecks(JSON.stringify([{ name: "x", bucket: "fail" }, { name: "y", bucket: "cancel" }])));
    expect(red.failed).toBe(true);
    expect(red.pending).toBe(false);
    expect(red.failures.map((check) => check.name)).toEqual(["x", "y"]);
  });

  it("tallies buckets instead of listing them, so a settled stack stays short", () => {
    expect(countsLine(summarize(parseChecks(threeChecks)))).toBe("1 pass · 1 pending · 1 skipping");
  });
});

describe("ci-wait.mjs output", () => {
  function captureLog(run) {
    const lines = [];
    const original = console.log;
    console.log = (line) => lines.push(line);
    try {
      run();
    } finally {
      console.log = original;
    }
    return lines;
  }

  it("opens a pull request with one tally line, not its roster", () => {
    const many = Array.from({ length: 26 }, (_, index) => ({ name: `check ${index}`, bucket: "pass" }));
    const lines = captureLog(() => printOpening(2129, summarize(many), "12:00:00"));
    expect(lines).toEqual(["12:00:00 #2129  26 pass"]);
  });

  it("names the pull request for the current branch", () => {
    const lines = captureLog(() => printOpening(null, summarize(parseChecks(threeChecks)), "12:00:00"));
    expect(lines[0]).toContain("current branch");
  });

  it("ends with one verdict per pull request", () => {
    const lines = captureLog(() => printVerdict([
      { pr: 8, failed: true, pending: false, counts: { pass: 24, fail: 1, pending: 0, skipping: 1, cancel: 0 } },
      { pr: 9, failed: false, pending: true, counts: { pass: 24, fail: 0, pending: 1, skipping: 1, cancel: 0 } },
    ]));
    expect(lines.filter((line) => line !== "")).toEqual([
      "#8  FAIL  24 pass · 1 fail · 1 skipping",
      "#9  PENDING  24 pass · 1 pending · 1 skipping",
    ]);
  });
});