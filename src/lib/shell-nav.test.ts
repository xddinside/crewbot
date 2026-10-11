// The top bar's pills are derived from what is already selected, never stored
// a second time. That is the whole reason this file is pure and tested: a
// redesign that keeps its own notion of "where am I" loses a screen the first
// time the two disagree.
import { describe, expect, it } from "vitest";
import { DESTINATIONS, DESTINATION_LABEL, destinationFor, isDestinationActive } from "./shell-nav";

const at = (activeView: "chat" | "team-map" | "routines", selectedIsGroup: boolean) =>
  destinationFor({ activeView, selectedId: selectedIsGroup ? "room-1" : "bot-1", selectedIsGroup });

describe("destination", () => {
  it("puts a selected bot on Home", () => {
    expect(at("chat", false)).toBe("home");
  });

  it("puts a selected room on Projects", () => {
    expect(at("chat", true)).toBe("projects");
  });

  it("puts the team map on Crew", () => {
    expect(at("team-map", false)).toBe("crew");
  });

  it("keeps Crew lit while the automations calendar is open", () => {
    // The calendar is a secondary destination reached from Crew's Tools menu.
    // If the pill went dark there, the nav would deny where the user is.
    expect(at("routines", false)).toBe("crew");
  });

  it("lights a pill even before anything is selected", () => {
    // A boot with no bots yet still has a destination; an all-dark pill reads
    // as a broken nav.
    expect(destinationFor({ activeView: "chat", selectedId: "", selectedIsGroup: false })).toBe("home");
  });
});

describe("the pill set", () => {
  it("is the three the design names, in order", () => {
    expect([...DESTINATIONS]).toEqual(["home", "crew", "projects"]);
  });

  it("labels every destination", () => {
    for (const destination of DESTINATIONS) {
      expect(DESTINATION_LABEL[destination].length).toBeGreaterThan(0);
    }
  });

  it("marks exactly one destination current", () => {
    for (const current of DESTINATIONS) {
      const lit = DESTINATIONS.filter((d) => isDestinationActive(current, d));
      expect(lit).toEqual([current]);
    }
  });
});