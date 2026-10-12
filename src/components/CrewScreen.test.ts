// The crew roster is presentation, so what matters is that it presents *this*
// workspace: the user's own teams, the user's own Chiefs, the user's own bot
// names. These render it against a store fixture and read the markup back,
// because a roster that quietly showed Atlas / Nova / Sage regardless of what
// the workspace contains would look exactly right in a screenshot and be a lie
// in the product.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("navigator", { language: "en" });
  return { dispatch: vi.fn(), state: {} as Record<string, unknown> };
});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: () => Promise.reject(new Error("not called in a markup test")),
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});
// The mascots animate on a rAF loop; server rendering never starts one, but
// the module still reads the host's clock and document.
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
// posthog-js reads `window.addEventListener` at import time, and the stubbed
// window above is a bare object. The Crew screen reaches analytics through the
// team library it can open, so the module is mocked rather than the library.
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), initAnalytics: vi.fn() }));

const { CrewScreen, openCrewBot } = await import("./CrewScreen");

const bot = (over: Partial<Bot> & { id: string }): Bot =>
  ({
    threadId: `${over.id}-t`,
    name: over.id,
    title: "",
    description: "",
    notifications: false,
    color: "grey",
    unread: false,
    modelSelection: { instanceId: "i1", model: "m" },
    messages: [],
    ...over,
  }) as Bot;

const render = () =>
  renderToStaticMarkup(
    createElement(CrewScreen, {
      onOpenBot: () => {},
      onOpenTeamMap: () => {},
      onOpenTeamComputers: () => {},
      onOpenAll: () => {},
    }),
  ).replaceAll("<!-- -->", "");

beforeEach(() => {
  fixture.dispatch.mockClear();
  setLocale("en");
});

afterEach(() => {
  fixture.state = {};
});

describe("the roster", () => {
  it("heads each team with its own Chief and lists the rest underneath", () => {
    fixture.state = {
      bots: [
        bot({ id: "atlas", name: "Atlas", title: "Engineering", section: "Engineering", chiefOfStaff: true }),
        bot({ id: "forge", name: "Forge", title: "Implementation", section: "Engineering" }),
        bot({ id: "tracker", name: "Tracker", title: "Personal" }),
      ],
      sections: ["Engineering"],
    };
    const html = render();
    expect(html).toContain("Engineering");
    expect(html).toContain("Atlas");
    expect(html).toContain("Forge");
    expect(html).toContain("Talk to Atlas");
    // The unsectioned team is General, and it says it has no lead rather than
    // promoting Tracker into one.
    expect(html).toContain("General");
    expect(html).toContain("No lead yet");
    expect(html).toContain("1 specialist");
  });

  it("never renames a workspace to fit the mockup", () => {
    fixture.state = {
      bots: [bot({ id: "wrench", name: "Wrench", title: "Maintenance", section: "Workshop", chiefOfStaff: true })],
      sections: ["Workshop"],
    };
    const html = render();
    expect(html).toContain("Wrench");
    expect(html).toContain("Workshop");
    expect(html).not.toContain("Atlas");
  });

  it("leaves archived bots out of the roster and counts them in the footer", () => {
    fixture.state = {
      bots: [
        bot({ id: "live", name: "Live", section: "Engineering", chiefOfStaff: true }),
        bot({ id: "old", name: "Retired", hidden: true }),
      ],
      sections: ["Engineering"],
    };
    const html = render();
    expect(html).toContain("Live");
    expect(html).not.toContain("Retired");
    // …but the archive is still one click away, with its count.
    expect(html).toContain("Archived bots");
    expect(html).toMatch(/Archived bots[\s\S]{0,80}?>1</);
  });

  it("gives every bot its own menu, named for that bot", () => {
    fixture.state = {
      bots: [
        bot({ id: "atlas", name: "Atlas", section: "Engineering", chiefOfStaff: true }),
        bot({ id: "forge", name: "Forge", section: "Engineering" }),
      ],
      sections: ["Engineering"],
    };
    const html = render();
    expect(html).toContain('aria-label="Actions for Atlas"');
    expect(html).toContain('aria-label="Actions for Forge"');
  });

  it("carries the working and waiting dots the roster tree uses", () => {
    fixture.state = {
      bots: [
        bot({ id: "busy", name: "Busy", section: "Engineering", chiefOfStaff: true, busy: true }),
        bot({ id: "waiting", name: "Waiting", section: "Engineering", activity: "waiting-on-you" }),
      ],
      sections: ["Engineering"],
    };
    const html = render();
    expect(html).toContain('data-testid="crew-working-dot"');
    expect(html).toContain('aria-label="Waiting for you…"');
  });

  it("says so when the workspace has no bots at all", () => {
    fixture.state = { bots: [] };
    expect(render()).toContain("No bots yet");
  });
});

describe("the escape hatches", () => {
  beforeEach(() => {
    fixture.state = { bots: [bot({ id: "atlas", name: "Atlas", section: "Engineering", chiefOfStaff: true })], sections: ["Engineering"] };
  });

  it("keeps the map, the computers, the archive and the library reachable", () => {
    const html = render();
    expect(html).toContain("Team map");
    expect(html).toContain("Computers");
    expect(html).toContain("Archived bots");
    expect(html).toContain("Templates");
    expect(html).toContain("All conversations");
    expect(html).toContain("Create team");
    expect(html).toContain("Add specialist");
  });

  it("names the bot it talks to on the row itself", () => {
    expect(render()).toContain("Talk to Atlas");
  });
});

describe("the archived panel", () => {
  it("stays shut until it is asked for", () => {
    fixture.state = { bots: [bot({ id: "old", name: "Retired", hidden: true })] };
    // With nothing archived there is nothing to restore; the button is still
    // there so the route is not a secret.
    const html = render();
    expect(html).toContain("Archived bots");
    expect(html).not.toContain("Restore all");
  });
});

describe("a remote client", () => {
  it("does not offer the local-only crew controls", () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    fixture.state = { bots: [bot({ id: "atlas", name: "Atlas", section: "Engineering", chiefOfStaff: true })], sections: ["Engineering"] };
    const html = render();
    // Creating a bot stays; the host-only controls are what a remote client
    // has no business pressing.
    expect(html).toContain("Add specialist");
    expect(html).not.toContain("Create team");
    expect(html).not.toContain("Archived bots");
    // The roster itself is still there: a remote client can read crew.
    expect(html).toContain("Atlas");
    vi.stubGlobal("window", {});
  });
});

/** A group is a room; the profile counts them, the roster does not. */
export type CrewGroupFixture = Group;
describe("opening a bot", () => {
  it("selects it and hands it to the profile — in that order", () => {
    // The store owns the selection, the shell owns the hand-off; a roster row
    // and the profile's own entries go through this one pair of dispatches.
    const seen: unknown[] = [];
    openCrewBot(
      (action) => seen.push(action),
      (botId) => seen.push({ profile: botId }),
      "atlas",
    );
    expect(seen).toEqual([{ type: "select", id: "atlas" }, { profile: "atlas" }]);
  });
});
