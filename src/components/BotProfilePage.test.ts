// The profile page shows the same twelve sections the chat's settings panel
// folds into an accordion. These read the markup back against a store fixture,
// because the two surfaces can only stay one surface if they read the same
// section list and the same workspace counts.
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
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), initAnalytics: vi.fn() }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
// The hidden mount that keeps a memory draft alive is real in the app; here it
// is the editor's file fetches that would need a server.
vi.mock("./bot-settings/BotSectionBody", () => ({ BotSectionBody: () => null }));

const { BotProfilePage } = await import("./BotProfilePage");
const { BOT_SECTIONS } = await import("./bot-settings/sections");

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

const group = (over: Partial<Group> & { id: string }): Group =>
  ({
    threadId: `${over.id}-t`,
    name: over.id,
    memberIds: [],
    unread: false,
    createdAt: 0,
    messages: [],
    ...over,
  }) as Group;

const render = (target: Bot = bot({ id: "atlas", name: "Atlas" })) =>
  renderToStaticMarkup(createElement(BotProfilePage, { bot: target, onBack: () => {} })).replaceAll("<!-- -->", "");

beforeEach(() => {
  fixture.dispatch.mockClear();
  setLocale("en");
});

afterEach(() => {
  fixture.state = {};
});

describe("the section list", () => {
  it("carries every section the settings panel has, in its order", () => {
    // F067: the profile is a new layout over the same twelve sections. If this
    // list ever loses one, the panel is the only place it survives — which is
    // how a feature goes missing without anyone noticing.
    const html = render();
    // The label as the catalog spells it, not as HTML escapes it.
    const text = html.replaceAll("&amp;", "&");
    for (const entry of BOT_SECTIONS) expect(text).toContain(entry.label);
    expect(BOT_SECTIONS.map((entry) => entry.id)).toEqual([
      "overview",
      "identity",
      "soul",
      "skills",
      "memory",
      "routines",
      "access",
      "model",
      "permissions",
      "voice",
      "history",
      "usage",
    ]);
  });

  it("reads its section from the store, so a deep link lands in the same place", () => {
    fixture.state = { botSettingsSection: "access" };
    const html = render();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Access");
  });
});

describe("the subtitle", () => {
  it("counts colleagues and rooms off the workspace, not off a mockup", () => {
    fixture.state = {
      bots: [
        bot({ id: "atlas", name: "Atlas", title: "Engineering lead", section: "Engineering", chiefOfStaff: true }),
        bot({ id: "forge", name: "Forge", section: "Engineering" }),
        bot({ id: "probe", name: "Probe", section: "Engineering" }),
      ],
      sections: ["Engineering"],
      groups: [group({ id: "launch", name: "Launch", memberIds: ["atlas"] })],
    };
    const html = render(
      bot({ id: "atlas", name: "Atlas", title: "Engineering lead", section: "Engineering", chiefOfStaff: true }),
    );
    expect(html.replaceAll("&middot;", "·")).toContain("Engineering lead · 2 specialists · 1 project");
  });

  it("says nothing it cannot count", () => {
    const html = render(bot({ id: "solo", name: "Solo" }));
    expect(html).toContain("No title set");
    expect(html).toContain("0 specialists");
  });
});

describe("the summary column", () => {
  it("is a set of jumps, never a second editor", () => {
    fixture.state = {
      botSettingsSection: "overview",
      bots: [bot({ id: "atlas", name: "Atlas", soul: "Plan clearly. Delegate bounded work.", alwaysAllow: ["bash", "read"] })],
    };
    const html = render(
      bot({ id: "atlas", name: "Atlas", soul: "Plan clearly. Delegate bounded work.", alwaysAllow: ["bash", "read"] }),
    );
    // The soul is readable here…
    expect(html).toContain("Plan clearly");
    // …and the real editors are in the sections, not on this card.
    expect(html).not.toContain("<textarea");
    expect(html).toContain("2</span>");
  });

  it("leaves out a number it could not fetch rather than showing a zero", () => {
    fixture.state = { botSettingsSection: "overview" };
    const html = render(bot({ id: "atlas", name: "Atlas" }));
    expect(html).toContain("Loading…");
  });
});