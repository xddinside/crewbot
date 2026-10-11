import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageActions, MessageMenu, type MessageActionItem } from "./MessageActions";

const items: MessageActionItem[] = [
  { id: "copy", label: "Copy", icon: createElement("span", null, "C"), onSelect: () => {} },
  { id: "pin", label: "Pin", icon: createElement("span", null, "P"), onSelect: () => {} },
];

/** The handle. The open menu portals to `document.body`, which the static
 *  renderer cannot produce — so the handle is asserted here and the rows are
 *  asserted through `MessageMenu`, which is the same element the portal wraps. */
const handle = (props: Partial<Parameters<typeof MessageActions>[0]> = {}) =>
  renderToStaticMarkup(createElement(MessageActions, { side: "bot", items, label: "Message actions", ...props }));

const menu = (props: Partial<Parameters<typeof MessageMenu>[0]> = {}) =>
  renderToStaticMarkup(createElement(MessageMenu, { label: "Message actions", items, ...props }));

describe("MessageActions", () => {
  it("keeps one quiet collapsed handle beside the bubble", () => {
    const html = handle();
    expect(html).toContain('aria-label="Message actions"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-side="bot"');
    expect(html).not.toContain('data-open="true"');
    // a handle with nothing to do is inert rather than opening an empty menu
    expect(handle({ items: [] })).toContain("disabled=\"\"");
  });

  it("stays open while a control inside it must remain reachable", () => {
    expect(handle({ forceOpen: true })).toContain('data-open="true"');
  });

  it("tells the two sides apart so the menu opens toward the bubble", () => {
    expect(handle({ side: "user" })).toContain('data-side="user"');
    expect(handle({ side: "bot" })).toContain('data-side="bot"');
  });
});

describe("MessageMenu", () => {
  it("names every row instead of leaving a glyph to a tooltip", () => {
    const html = menu();
    expect(html).toContain('role="menu"');
    expect(html).toContain("Copy");
    expect(html).toContain("Pin");
    expect(html).toContain('role="menuitem"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
  });

  it("is frosted glass like every other popover in the app", () => {
    expect(menu()).toContain("glass-popover");
  });

  it("lets a destructive row read as one", () => {
    const html = menu({
      items: [...items, { id: "delete", label: "Delete", icon: createElement("span"), onSelect: () => {}, tone: "danger", separator: true }],
    });
    expect(html).toContain("text-danger");
    expect(html).toContain("border-t");
  });

  it("keeps an ineligible row present but inert", () => {
    const html = menu({ items: [{ ...items[0], disabled: true }] });
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Copy");
  });
});