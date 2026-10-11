// The room screen has one shape rule worth pinning: the header — the project's
// name, its standing instruction — stands on the sky, and only the
// conversation below it is frosted. A future edit that puts the glass back on
// the whole column would look fine and break the rule, so it is asserted here
// rather than left to a screenshot nobody takes.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState },
      dispatch: fixture.dispatch,
    }),
  };
});
// The real module rides along; the tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./DesktopCapabilities")>()),
  useDesktopCapabilities: () => ({
    capabilities: { dictation: { available: false }, host: { packaged: true } },
    ready: true,
  }),
  useCaptionChrome: () => ({
    dragStyle: {},
    noDragStyle: {},
    controlsShiftStyle: {},
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { GroupView } = await import("./GroupView");

const room = {
  id: "g",
  threadId: "gt",
  name: "Launch v1.0",
  memberIds: ["b1"],
  defaultResponder: { kind: "member" as const, botId: "b1" },
  bulletin: "Auth plan",
  unread: false,
  createdAt: 1,
  messages: [],
};

const markup = renderToStaticMarkup(
  createElement(GroupView, { group: room as never }),
);

describe("the room's layout", () => {
  it("puts the name and the room's line on the canvas, before the glass", () => {
    const glass = markup.indexOf("glass-panel");
    expect(glass).toBeGreaterThan(-1);
    expect(markup.indexOf("Launch v1.0")).toBeLessThan(glass);
    expect(markup.indexOf("Auth plan")).toBeLessThan(glass);
  });

  it("frosters the conversation, not the whole column", () => {
    // one frosted surface, and the transcript lives inside it
    expect(markup.match(/glass-panel/g)).toHaveLength(1);
    expect(glassIndex(markup)).toBeLessThan(markup.indexOf('role="log"'));
    expect(markup.indexOf('role="log"')).toBeLessThan(
      markup.indexOf('data-tour="composer"'),
    );
  });
});

const glassIndex = (markup: string) => markup.indexOf("glass-panel");
