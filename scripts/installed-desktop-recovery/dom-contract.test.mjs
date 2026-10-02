// The DOM contract the installed desktop recovery fixture drives.
//
// `scripts/verify-installed-desktop-recovery.mjs` runs only on a GitHub-hosted
// Ubuntu runner, because it needs `dpkg`, an X server and a real GTK chooser.
// It finds its controls by attribute, role and shipped label. If one of those
// strings is renamed, this fixture stops working — and today it would stop
// working silently, on the runner, in a job nobody can run locally.
//
// So the selectors are pinned here instead, against the shipped components. A
// rename that would break the runner journey fails this test first, in the
// normal suite, in seconds. The folder-recovery row itself is pinned in
// `src/components/ChatView.controls.test.ts`, which already renders it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalModeSelector, approvalModeOptionsFor } from "@/components/ApprovalModeSelector";
import { FullAccessWarning } from "@/components/FullAccessWarning";
import { SidebarThreadRow } from "@/components/SidebarThreadRow";
import { t } from "@/lib/i18n";
import { supportsApprovalMode } from "../../shared/approval-mode";

// The provider name the fixture configures as its fake engine's display name.
// The composer's approval trigger is "<mode> for <provider>", so this string is
// what makes the trigger findable on the page.
const PROVIDER = "Recovery fixture";
// The driver kind the server reports for the `claudeAgent` instance the
// fixture configures. It decides which approval levels the menu offers, so
// the fixture's menu expectations are pinned against the real one.
const CLAUDE_DRIVER_KIND = "claudeAgent";

/** The fixture's own matching rules, copied from the module that runs on the
 * runner. If a rule is relaxed here it must be relaxed there too. */
const FULL_ACCESS_ENTRY = /^full access$/i;
const FULL_ACCESS_CONFIRM = /enable full access/i;
const STOP_CONTROL = /stop this turn/i;

describe("installed recovery fixture selectors", () => {
  it("finds the selected thread by the sidebar row attributes the fixture queries", () => {
    const task = { threadId: "thread-fixture", title: "Fixture thread" };
    const row = (current) => renderToStaticMarkup(createElement(SidebarThreadRow, {
      task,
      ownerId: "bot-fixture",
      current,
      onSelect: () => {},
      onRename: () => {},
      onDelete: () => {},
    }));
    // The fixture clicks `[data-sidebar-thread-row="<id>"]` and then waits for
    // `aria-current="page"` to prove the renderer really switched threads.
    expect(row(true)).toContain('data-sidebar-thread-row="thread-fixture"');
    expect(row(true)).toMatch(/aria-current="page"/);
    expect(row(false)).toContain('data-sidebar-thread-row="thread-fixture"');
    expect(row(false)).not.toMatch(/aria-current="page"/);
  });

  it("keeps the Stop label the fixture waits for while a turn runs", () => {
    // `CLICK_STOP` and the "a turn is running" wait both match this label on
    // the composer's Stop button. The button itself only exists while the thread
    // is busy, which is the composer's own covered behaviour; the label is what
    // the fixture reaches for, so the label is what is pinned here.
    expect(t("chat.stopTurn")).toMatch(STOP_CONTROL);
  });
});

describe("installed approval fixture selectors", () => {
  it("names the composer's approval trigger the way the fixture finds it", () => {
    const markup = renderToStaticMarkup(createElement(ApprovalModeSelector, {
      approvalMode: "ask",
      autoApprove: false,
      providerName: PROVIDER,
      driverKind: CLAUDE_DRIVER_KIND,
      onSelect: () => {},
      trustedModesAvailable: true,
    }));
    // `CHOOSE_APPROVAL_MODE` picks the `aria-haspopup="menu"` trigger whose
    // aria-label ends with " for <provider>".
    expect(markup).toMatch(/aria-haspopup="menu"/);
    expect(markup).toContain(`aria-label="Ask for approval for ${PROVIDER}"`);
    expect(markup).toMatch(/aria-expanded="false"/);
  });

  it("offers Full access under the exact label the fixture clicks", () => {
    const options = approvalModeOptionsFor(CLAUDE_DRIVER_KIND, true);
    const full = options.find((option) => FULL_ACCESS_ENTRY.test(option.label));
    expect(full, "the menu entry the fixture clicks must exist").toBeDefined();
    expect(full?.mode).toBe("full");
    expect(supportsApprovalMode(CLAUDE_DRIVER_KIND, "full")).toBe(true);
  });

  it("drops Full and Custom wherever the desktop is not trusted", () => {
    // Outside the packaged app the menu drops Full and Custom. The fixture then
    // reports "the installed menu offered no Full access entry", which is the
    // correct outcome: this journey is only meaningful in the installed app.
    const labels = approvalModeOptionsFor(CLAUDE_DRIVER_KIND, false).map((option) => option.label);
    expect(labels.some((label) => FULL_ACCESS_ENTRY.test(label))).toBe(false);
    expect(labels.some((label) => /^custom/i.test(label))).toBe(false);
    expect(labels.some((label) => /^ask for approval$/i.test(label))).toBe(true);
  });

  it("confirms Full access through the dialog the fixture confirms", () => {
    const markup = renderToStaticMarkup(createElement(FullAccessWarning, {
      open: true,
      scope: "thread",
      onCancel: () => {},
      onConfirm: () => {},
    }));
    expect(markup).toMatch(/role="alertdialog"/);
    expect(markup).toMatch(FULL_ACCESS_CONFIRM);
  });
});