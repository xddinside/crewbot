// The mode menu and the `/` picker must never disagree. The gates themselves
// are pure and tested in lib/composer-commands; this file covers the half that
// is presentation over them: which rows appear, which ones say why they are
// off, and that choosing one reports the choice instead of deciding it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  composerModeOptions,
  type ComposerModeId,
} from "@/lib/composer-commands";
import { ComposerModeList, ComposerModeMenu } from "./ComposerModeMenu";

const roomOptions = composerModeOptions({
  room: true,
  learn: true,
  setup: false,
});
const directOptions = composerModeOptions({
  room: false,
  learn: true,
  setup: true,
});

const text = (markup: string) =>
  markup
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("ComposerModeMenu", () => {
  it("names the current mode on the trigger and opens a listbox over it", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerModeMenu, {
        options: roomOptions,
        value: "chat",
        onSelect: () => {},
      }),
    );
    expect(text(markup)).toContain("Chat");
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    // nothing renders until it is opened
    expect(markup).not.toContain('role="listbox"');
  });

  it("reads Goal on the trigger the moment Goal is the mode", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerModeMenu, {
        options: roomOptions,
        value: "goal" as ComposerModeId,
        onSelect: () => {},
      }),
    );
    expect(text(markup)).toContain("Goal");
  });

  it("goes inert while the composer does", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerModeMenu, {
        options: roomOptions,
        value: "chat",
        onSelect: () => {},
        disabled: true,
      }),
    );
    expect(markup).toContain("disabled");
  });
});

describe("ComposerModeList", () => {
  it("lists every mode and marks the one in force", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerModeList, {
        options: roomOptions,
        value: "goal",
        onSelect: () => {},
      }),
    );
    const labels = text(markup);
    expect(labels).toContain("Chat");
    expect(labels).toContain("Goal");
    expect(labels).toContain("Learn");
    expect(labels).toContain("Setup");
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it("keeps an unavailable row and says why, instead of hiding it", () => {
    const markup = renderToStaticMarkup(
      createElement(ComposerModeList, {
        options: roomOptions,
        value: "chat",
        onSelect: () => {},
      }),
    );
    // a room can run a goal and cannot set itself up; the reason is the copy
    expect(text(markup)).toContain("Keep a team working until it is done");
    expect(text(markup)).toContain("Available in a direct chat");
    // the one row it cannot offer is disabled, so a click cannot go nowhere
    expect(markup.match(/disabled=""/g)?.length).toBe(1);
  });

  it("reports the mode that was chosen and does not decide it itself", () => {
    const picked: string[] = [];
    const markup = renderToStaticMarkup(
      createElement(ComposerModeList, {
        options: directOptions,
        value: "chat",
        onSelect: (mode) => picked.push(mode),
      }),
    );
    // Learn is available in a direct chat; Goal is not
    expect(text(markup)).toContain("Draft a reusable skill");
    expect(markup.match(/disabled=""/g)?.length).toBe(1);
    expect(picked).toEqual([]);
    expect(markup).toContain('role="option"');
  });
});
