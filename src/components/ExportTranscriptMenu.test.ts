import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { ConversationOverflowMenu, ConversationOverflowRows } from "./ExportTranscriptMenu";

const messages: Message[] = [
  { id: "m1", role: "user", kind: "text", at: 1, text: "Refresh tokens?" },
  { id: "m2", role: "bot", kind: "text", at: 2, text: "Rotate them on each use." },
];

const noop = () => {};
const rows = (props: Partial<Parameters<typeof ConversationOverflowRows>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ConversationOverflowRows, {
      hasMessages: true,
      copied: false,
      copyFailed: false,
      onCopy: noop,
      onDownload: noop,
      onClose: noop,
      ...props,
    }),
  );

const markup = (props: Partial<Parameters<typeof ConversationOverflowMenu>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ConversationOverflowMenu, { title: "Atlas", messages, botName: "Atlas", ...props }),
  );

describe("the conversation header's overflow menu", () => {
  it("is one quiet ellipsis until it is opened", () => {
    const html = markup();
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    // the rows only exist while it is open — nothing is duplicated in the DOM
    expect(html).not.toContain("Download .md");
  });

  it("carries the export as named rows, not glyphs with a tooltip", () => {
    const html = rows();
    expect(html).toContain("Copy Markdown");
    expect(html).toContain("Download .md");
    expect(html).toContain("glass-popover");
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
  });

  it("invents no share link: Markdown is the whole way out", () => {
    expect(rows()).not.toMatch(/share/i);
  });

  it("says so when there is nothing to export rather than offering a dead row", () => {
    const html = rows({ hasMessages: false });
    expect(html).toContain("No messages to export yet.");
    expect(html).toContain("disabled=");
  });

  it("adds the Inspector below a hairline when the header has one", () => {
    const html = rows({ extraItems: [{ id: "inspector", label: "Inspector", icon: null, pressed: true, onSelect: noop }] });
    expect(html).toContain("Inspector");
    expect(html).toContain("border-t");
    expect(html).toContain('aria-pressed="true"');
  });
});