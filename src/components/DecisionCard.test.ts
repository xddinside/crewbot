import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChoiceList, DecisionCard, DecisionReceipt } from "./DecisionCard";

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("DecisionCard", () => {
  it("is one frosted surface with a glyph, a title and an aside", () => {
    const markup = render(createElement(DecisionCard, {
      glyph: createElement("span", null, "g"),
      title: "Permission requested",
      aside: "Bash",
      asideTitle: "Bash",
    }, "body"));

    expect(markup).toContain("glass-card");
    expect(markup).toContain("Permission requested");
    expect(markup).toContain('title="Bash"');
    // the title is its own line so a card cannot wrap a phrase into its meta
    expect(markup).toMatch(/Permission requested<\/div>/);
  });

  it("softens an answered card without removing it", () => {
    expect(render(createElement(DecisionCard, { title: "Asked", settled: true }))).toContain("opacity-75");
    expect(render(createElement(DecisionCard, { title: "Asked" }))).not.toContain("opacity-75");
  });

  it("puts a footer under a hairline rather than floating it", () => {
    const markup = render(createElement(DecisionCard, { title: "Asked", footer: "Deny" }));
    expect(markup).toMatch(/border-t border-hairline\/25[^"]*">Deny<\/div>/);
  });

  it("passes its own hooks through to the surface, so a card can stay a region", () => {
    const markup = render(createElement(DecisionCard, {
      title: "Pending",
      role: "region",
      "aria-live": "polite",
    }));
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("DecisionReceipt", () => {
  it("reads the outcome, not the button that produced it", () => {
    const allowed = render(createElement(DecisionReceipt, { settled: true, allow: "Allowed", deny: "Denied", waiting: "Waiting" }));
    expect(allowed).toContain("Allowed");
    expect(allowed).not.toContain("Denied");

    const denied = render(createElement(DecisionReceipt, { settled: true, allow: undefined, deny: "Denied", waiting: "Waiting" }));
    expect(denied).toContain("Denied");

    const open = render(createElement(DecisionReceipt, { settled: false, allow: "Allowed", deny: "Denied", waiting: "Waiting" }));
    expect(open).toContain("Waiting");
  });
});

describe("ChoiceList", () => {
  const noop = () => undefined;

  it("lays a short single-choice question out as a row of chips", () => {
    const markup = render(createElement(ChoiceList, {
      question: "Which session expiry should we ship?",
      options: [{ label: "7 days" }, { label: "30 days" }],
      picked: ["7 days"],
      multiSelect: false,
      onChoose: noop,
      otherLabel: "Other",
      onOther: noop,
    }));

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain("flex flex-wrap gap-2");
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
    // "Other" is a choice like any other, and it is last
    expect(markup.indexOf("30 days")).toBeLessThan(markup.indexOf("Other"));
  });

  it("gives a described option its own row and a multi-select its ticks", () => {
    const described = render(createElement(ChoiceList, {
      question: "Which model?",
      options: [{ label: "Opus", description: "What it had before." }],
      picked: [],
      multiSelect: false,
      onChoose: noop,
    }));
    expect(described).toContain("overflow-hidden rounded-xl");
    expect(described).not.toContain("flex flex-wrap gap-2");

    const multi = render(createElement(ChoiceList, {
      question: "Which stores?",
      options: [{ label: "Instamart" }],
      picked: ["Instamart"],
      multiSelect: true,
      onChoose: noop,
    }));
    expect(multi).toContain('role="group"');
    expect(multi).toContain('role="checkbox"');
  });

  it("marks the Other entry by position, not by matching its label", () => {
    // A real option called "Other" must stay an ordinary choice.
    const markup = render(createElement(ChoiceList, {
      question: "Which one?",
      options: [{ label: "Other" }],
      picked: ["Other"],
      multiSelect: false,
      onChoose: noop,
      onOther: noop,
      otherLabel: "Other",
    }));
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("honours a replacement marker", () => {
    const markup = render(createElement(ChoiceList, {
      question: "Pick one",
      options: [{ label: "Work" }],
      picked: [],
      multiSelect: false,
      onChoose: noop,
      marker: () => createElement("span", null, "A"),
    }));
    expect(markup).toContain("A");
  });
});
