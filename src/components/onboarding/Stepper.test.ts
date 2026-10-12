// The step rail that sits above the welcome card. Its states are the whole
// job: a person has to see at a glance which steps are done, which one they
// are on, and what is left.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Stepper, stepStates } from "./Stepper";

describe("step states", () => {
  it("marks everything before the current step done", () => {
    expect(stepStates(5, 0)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(stepStates(5, 3)).toEqual(["done", "done", "done", "current", "todo"]);
  });

  it("has no current step when the flow is finished", () => {
    expect(stepStates(3, 3)).toEqual(["done", "done", "done"]);
  });

  it("never invents steps", () => {
    expect(stepStates(0, 0)).toEqual([]);
    expect(stepStates(-2, 1)).toEqual([]);
  });
});

describe("the step rail", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(Stepper, { steps: ["About you", "Engines", "Remote access"], index: 1, label: "Setup steps" }),
    );

  it("names every step and marks the current one", () => {
    const html = render();
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toContain("About you");
    expect(html).toContain("Engines");
    expect(html).toContain("Remote access");
    expect(html).toContain('aria-current="step"');
  });

  it("shows one current step, never two", () => {
    const html = render();
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("lists the steps in order", () => {
    const html = render();
    expect(html.indexOf("About you")).toBeLessThan(html.indexOf("Engines"));
    expect(html.indexOf("Engines")).toBeLessThan(html.indexOf("Remote access"));
  });
});