import { describe, expect, it } from "vitest";

import { choiceLayout } from "./decision-card";

describe("choiceLayout", () => {
  it("puts a short single-choice question in a row of chips", () => {
    expect(
      choiceLayout([{ label: "7 days" }, { label: "30 days" }, { label: "Other" }], false),
    ).toBe("chips");
  });

  it("gives a description its own row", () => {
    expect(
      choiceLayout(
        [
          { label: "Claude Opus 5", description: "What the bot had before." },
          { label: "OpenAI Codex", description: "Reads AGENTS.md." },
        ],
        false,
      ),
    ).toBe("rows");
  });

  it("keeps a long question in rows even without explanations", () => {
    expect(
      choiceLayout(
        Array.from({ length: 5 }, (_, index) => ({ label: `Option ${index}` })),
        false,
      ),
    ).toBe("rows");
  });

  it("gives a label that cannot fit one chip its own row", () => {
    expect(choiceLayout([{ label: "A".repeat(25) }, { label: "Short" }], false)).toBe("rows");
  });

  it("always uses rows for a multi-select, however short the options are", () => {
    expect(choiceLayout([{ label: "Instamart" }, { label: "Kroger" }], true)).toBe("rows");
  });

  it("has no row to fill when a question arrived without options", () => {
    expect(choiceLayout([], false)).toBe("rows");
  });
});
