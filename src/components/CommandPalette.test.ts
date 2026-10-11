import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const bots: Bot[] = [
  {
    id: "atlas", threadId: "t1", name: "Atlas", title: "Engineering", description: "", color: "green",
    notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "x", model: "m" },
  },
];
const groups: Group[] = [
  {
    id: "launch", threadId: "g1", name: "Launch v1.0", bulletin: "", messages: [], tasks: [],
    members: [], responders: [], working: false, cwd: "", unread: false, createdAt: 1,
  } as unknown as Group,
];

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, bots, groups }, dispatch: vi.fn() }),
  };
});

const { CommandPalette } = await import("./CommandPalette");

const sheet = () => renderToStaticMarkup(createElement(CommandPalette, { open: true }));
const closed = () => renderToStaticMarkup(createElement(CommandPalette, { open: false }));

describe("the Ctrl+K search sheet", () => {
  it("renders nothing when it is closed", () => {
    expect(closed()).toBe("");
  });

  it("is a frosted sheet, not a black window", () => {
    const html = sheet();
    expect(html).toContain("glass-sheet");
    expect(html).toContain("aria-modal=\"true\"");
    // a pale veil: the conversation underneath stays recognisable
    expect(html).not.toContain("bg-black/50");
  });

  it("lists bots and rooms from local state, with no query typed", () => {
    const html = sheet();
    expect(html).toContain("Atlas");
    expect(html).toContain("Engineering");
    expect(html).toContain("Launch v1.0");
  });

  it("says which sheet this is and which chord opens it", () => {
    const html = sheet();
    expect(html).toContain("Search conversations");
    expect(html).toContain("Ctrl+K");
  });

  it("tells the reader the arrows move and Enter opens, and offers the shortcut sheet", () => {
    const html = sheet();
    expect(html).toContain("Navigate");
    expect(html).toContain("Open");
    expect(html).toContain("Close");
    expect(html).toContain("Keyboard shortcuts");
  });
});