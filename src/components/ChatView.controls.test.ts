import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), model: null as ComponentProps<typeof ModelPicker> | null,
    approval: null as ComponentProps<typeof ApprovalModeSelector> | null };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
// The real useCaptionChrome rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
  fixture.model = props;
  return createElement("span", { "data-test-model-control": true });
} }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (props: ComponentProps<typeof ApprovalModeSelector>) => {
  fixture.approval = props;
  return createElement("span", { "data-test-approval-control": true });
} }));

const {
  ChatView,
  ErrorRow,
  attemptWorkingFolderRecovery,
  canRestartWorkingFolderForFailure,
  createWorkingFolderRecoveryLatch,
  latestWorkingFolderFailure,
} = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  fixture.dispatch.mockClear();
  delete window.ogb;
});

const bot: Bot = {
  id: "bot", threadId: "selected", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "thread-model" }, approvalMode: "ask" }],
};
const userMessage = (id: string, text: string): Message => ({ id, role: "user", kind: "text", at: 1, text });
const folderError = (id: string, folder: string): Message => ({
  id, role: "bot", kind: "activity", at: 2,
  tool: { name: `error: the working folder ${folder} is unavailable`, ok: false },
});

/** The recovery lifecycle with every collaborator recorded. `state` is what the
 * component would read at that instant, so a test can move it between the
 * picker and the PATCH exactly as a thread switch or a newer turn would. */
function recoveryHarness(options: {
  choose: (state: () => { threadId: string; busy: boolean; target: unknown }) => Promise<string | null>;
  restart?: () => Promise<unknown>;
  state?: Partial<{ threadId: string; busy: boolean; target: unknown }>;
}) {
  const calls = { choose: 0, restart: [] as unknown[], retry: [] as unknown[], errors: [] as string[] };
  const state = { threadId: "selected", busy: false, target: latestTarget, ...options.state };
  const attempt = () => attemptWorkingFolderRecovery({
    target: latestTarget,
    chooseCwd: async () => {
      calls.choose += 1;
      return options.choose(() => state);
    },
    isStillCurrent: () => canRestartWorkingFolderForFailure(
      { botId: "bot", threadId: state.threadId, busy: state.busy, target: state.target as never },
      "bot",
      // The component captured this row's thread at render; the live state is
      // what may have moved away from it.
      "selected",
      latestTarget,
    ),
    restartTask: async (request) => {
      calls.restart.push(request);
      return options.restart ? options.restart() : undefined;
    },
    retryRequest: (request) => calls.retry.push(request),
    onError: (message) => calls.errors.push(message),
  });
  return { calls, state, attempt };
}

const latestTarget = {
  errorMessageId: "current-folder-error",
  userMessageId: "failed-user",
  userMessageText: "run the current request",
};

describe("working folder recovery lifecycle", () => {
  it("retries the exact failed request once against the pinned task", async () => {
    const { calls, attempt } = recoveryHarness({ choose: async () => "/fixture/replacement" });

    expect(await attempt()).toEqual({ status: "retried", cwd: "/fixture/replacement" });
    expect(calls.choose).toBe(1);
    expect(calls.restart).toEqual([{
      restartAtCwd: "/fixture/replacement",
      expectedErrorMessageId: "current-folder-error",
      expectedUserMessageId: "failed-user",
    }]);
    expect(calls.retry).toEqual([{ messageId: "failed-user", text: "run the current request" }]);
    expect(calls.errors).toEqual([]);
  });

  it("leaves state and transcript untouched when the chooser is cancelled", async () => {
    const { calls, attempt } = recoveryHarness({ choose: async () => null });

    expect(await attempt()).toEqual({ status: "cancelled" });
    expect(calls.restart).toEqual([]);
    expect(calls.retry).toEqual([]);
    expect(calls.errors).toEqual([]);
  });

  it("drops a selection that a thread switch made stale instead of patching another task", async () => {
    // The native picker is open; the user picks a sibling thread before the
    // dialog closes. The captured action must not reach the new task.
    const { calls, state, attempt } = recoveryHarness({
      choose: async () => {
        state.threadId = "other-thread";
        return "/fixture/replacement";
      },
    });

    expect(await attempt()).toEqual({ status: "stale" });
    expect(calls.restart).toEqual([]);
    expect(calls.retry).toEqual([]);
  });

  it("drops a selection that a newer settled turn made stale", async () => {
    const { calls, state, attempt } = recoveryHarness({
      choose: async () => {
        state.target = null;
        return "/fixture/replacement";
      },
    });

    expect(await attempt()).toEqual({ status: "stale" });
    expect(calls.restart).toEqual([]);
    expect(calls.retry).toEqual([]);
  });

  it("drops a selection that a turn started while the picker was open made stale", async () => {
    const { calls, state, attempt } = recoveryHarness({
      choose: async () => {
        state.busy = true;
        return "/fixture/replacement";
      },
    });

    expect(await attempt()).toEqual({ status: "stale" });
    expect(calls.restart).toEqual([]);
    expect(calls.retry).toEqual([]);
  });

  it("drops a retry whose PATCH completed after the thread moved on", async () => {
    const { calls, state, attempt } = recoveryHarness({
      choose: async () => "/fixture/replacement",
      restart: async () => {
        state.threadId = "other-thread";
      },
    });

    expect(await attempt()).toEqual({ status: "stale" });
    expect(calls.restart).toHaveLength(1);
    expect(calls.retry).toEqual([]);
  });

  it("reports a refused PATCH to a still-current failure and never replays it", async () => {
    const { calls, attempt } = recoveryHarness({
      choose: async () => "/fixture/replacement",
      restart: async () => {
        throw new Error("409 this thread changed");
      },
    });

    expect((await attempt()).status).toBe("failed");
    expect(calls.errors).toEqual(["409 this thread changed"]);
    expect(calls.retry).toEqual([]);
  });

  it("stays silent about a refusal that arrived after the thread moved on", async () => {
    const { calls, state, attempt } = recoveryHarness({
      choose: async () => "/fixture/replacement",
      restart: async () => {
        state.target = null;
        throw new Error("409 this thread changed");
      },
    });

    expect((await attempt()).status).toBe("failed");
    expect(calls.errors).toEqual([]);
    expect(calls.retry).toEqual([]);
  });

  it("never asks for a second folder while one activation is still open", async () => {
    // The duplicate guard is the row's own latch, so a double activation cannot
    // reach the lifecycle at all: one chooser, one PATCH, one replay.
    const latch = createWorkingFolderRecoveryLatch();
    const { calls, attempt } = recoveryHarness({
      choose: async () => {
        expect(latch.acquire()).toBe(false);
        expect(latch.busy).toBe(true);
        return "/fixture/replacement";
      },
    });
    expect(latch.acquire()).toBe(true);

    expect(await attempt()).toEqual({ status: "retried", cwd: "/fixture/replacement" });
    latch.release();
    expect(calls.choose).toBe(1);
    expect(calls.restart).toHaveLength(1);
    expect(calls.retry).toHaveLength(1);
    // The control is inert for the whole lifecycle, so a second click cannot
    // even reach the handler.
    expect(renderToStaticMarkup(createElement(ErrorRow, {
      message: "the working folder no longer exists: /missing/project",
      onChooseWorkingFolder: () => {},
      workingFolderRecoveryPending: true,
    }))).toMatch(/<button[^>]*disabled=""[^>]*>\s*(?:<svg)?.*?Choose folder and retry/s);
  });
});

describe("the installed recovery fixture's own selectors", () => {
  // `scripts/verify-installed-desktop-recovery.mjs` drives the installed app
  // through these exact rules. It cannot run on a development machine, so a
  // rename that would break it has to fail here instead, silently breaking a
  // job nobody can run locally.
  const label = (markup: string) =>
    markup.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const row = (overrides: Partial<ComponentProps<typeof ErrorRow>>) => renderToStaticMarkup(createElement(ErrorRow, {
    message: "the working folder no longer exists: /missing/project",
    onChooseWorkingFolder: () => {},
    workingFolderRecoveryPending: false,
    ...overrides,
  }));

  it("finds the recovery control by the label the fixture looks for", () => {
    expect(label(row({}))).toMatch(/choose folder and retry/i);
  });

  it("offers no recovery control for an error that is not a working-folder failure", () => {
    expect(label(row({ message: "the engine CLI is not installed" }))).not.toMatch(/choose folder and retry/i);
    expect(label(row({ message: "the working folder no longer exists: /missing/project", onChooseWorkingFolder: undefined })))
      .not.toMatch(/choose folder and retry/i);
  });
});

describe("thread control placement", () => {
  it("keeps the composer inert until the deleted thread's replacement transcript arrives", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, awaitingThreadSnapshot: true } }));
    expect(markup).toMatch(/<textarea[^>]*disabled=""[^>]*aria-busy="true"/);
    expect(markup).not.toContain("Finish group setup");
  });
  it("offers trusted modes in the composer without requiring a Full bot default", () => {
    const fullBot = { ...bot, busy: false, approvalMode: "full" as const };
    expect(renderToStaticMarkup(createElement(ChatView, { bot: fullBot }))).not.toContain("Use bot’s Full access for this thread");
    window.ogb = { approvals: { setMode: vi.fn() } } as unknown as NonNullable<Window["ogb"]>;
    expect(renderToStaticMarkup(createElement(ChatView, { bot: fullBot }))).not.toContain("Use bot’s Full access for this thread");
    renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(fixture.approval?.trustedModesAvailable).toBe(true);
    fixture.approval!.onSelect("custom");
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateTask", botId: "bot", threadId: "selected", patch: { approvalMode: "custom" } });
    delete window.ogb;
  });

  it("explains provider safety errors without offering an ineffective Retry", () => {
    const markup = renderToStaticMarkup(createElement(ErrorRow, { message: "Blocked by our safety systems", onRetry: () => {} }));
    expect(markup).toContain("Full access controls tool approvals, not provider safety checks");
    expect(markup).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(ErrorRow, { message: "Network timeout", onRetry: () => {} }))).toContain("<button");
  });
  it("keeps folder recovery off an old error after a later turn settles", () => {
    window.ogb = { pickFolder: vi.fn() } as unknown as NonNullable<Window["ogb"]>;
    const messages = [
      userMessage("old-user", "run in the removed folder"),
      folderError("old-folder-error", "/gone"),
      userMessage("later-user", "show the current status"),
      { id: "later-answer", role: "bot", kind: "text", at: 3, text: "Everything is running." } satisfies Message,
    ];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));

    expect(markup).toContain("the working folder /gone is unavailable");
    expect(markup).not.toContain(t("chat.chooseFolderAndRetry"));
    expect(latestWorkingFolderFailure(messages)).toBeNull();
  });
  it("offers recovery only for the terminal folder failure and binds it to that user turn", () => {
    window.ogb = { pickFolder: vi.fn() } as unknown as NonNullable<Window["ogb"]>;
    const messages = [
      userMessage("prior-user", "a completed request"),
      { id: "prior-answer", role: "bot", kind: "text", at: 2, text: "Done." } satisfies Message,
      userMessage("failed-user", "run the current request"),
      folderError("current-folder-error", "/current-missing"),
    ];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, busy: false, messages } }));

    const target = latestWorkingFolderFailure(messages);
    expect(target).toEqual({
      errorMessageId: "current-folder-error",
      userMessageId: "failed-user",
      userMessageText: "run the current request",
    });
    expect(markup).toContain(t("chat.chooseFolderAndRetry"));
    expect(markup.indexOf('data-mid="current-folder-error"')).toBeLessThan(markup.indexOf(t("chat.chooseFolderAndRetry")));
    expect(canRestartWorkingFolderForFailure({
      botId: "bot", threadId: "t1", busy: false, target,
    }, "bot", "t1", target!)).toBe(true);
    // A successful turn, a new busy turn, or a thread switch while the
    // native picker is open invalidates the captured action.
    expect(canRestartWorkingFolderForFailure({
      botId: "bot", threadId: "t1", busy: false, target: null,
    }, "bot", "t1", target!)).toBe(false);
    expect(canRestartWorkingFolderForFailure({
      botId: "bot", threadId: "t1", busy: true, target,
    }, "bot", "t1", target!)).toBe(false);
    expect(canRestartWorkingFolderForFailure({
      botId: "bot", threadId: "other-thread", busy: false, target,
    }, "bot", "t1", target!)).toBe(false);
  });

  it("replaces Retry with folder recovery for a broken working folder", () => {
    const markup = renderToStaticMarkup(createElement(ErrorRow, {
      message: "the working folder no longer exists: /missing/project",
      onRetry: () => {},
      onRestartWorkingFolder: () => {},
    }));
    expect(markup).toContain("Choose a valid folder to retry");
    expect(markup).toContain("Folder path");
    expect(markup).toContain("Use folder and retry");
    expect(markup).not.toContain(">Retry</button>");
  });

  it("offers the native folder picker as the recovery action when available", () => {
    const markup = renderToStaticMarkup(createElement(ErrorRow, {
      message: "the working folder can't be accessed because permission was denied: /private/project",
      onRetry: () => {},
      onChooseWorkingFolder: () => {},
    }));
    expect(markup).toContain("Choose folder and retry");
    expect(markup).not.toContain(">Retry</button>");
  });
  it.each([
    "شغّل الاختبارات\nThen run typecheck\nوبعدها ارفع الفرع",
    "שלום עולם\nThen run typecheck\nתודה רבה",
    `${"مرحبا\n".repeat(10)}Then run typecheck`,
  ])("applies per-line direction to the actual user text, including collapsed messages", (text) => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: {
      ...bot,
      messages: [{ id: "mixed-script", role: "user", kind: "text", at: 1, text }],
    } }));
    // unicode-bidi does not inherit: setting it on the bubble leaves this
    // inner text block LTR. Keep the class directly on the node with prose.
    expect(markup).toMatch(/<div class="chat-text[^"]*">(?:شغّل|שלום|مرحبا)/);
    expect(markup).not.toMatch(/class="[^"]*chat-text[^"\n]*bg-bubble-user/);
  });

  it("keeps the selected thread's model in the header and permissions inside the composer pill", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup.match(/data-test-model-control/g)).toHaveLength(1);
    expect(markup.indexOf("data-test-model-control")).toBeLessThan(markup.indexOf('role="log"'));
    expect(markup.indexOf("rounded-3xl bg-composer")).toBeGreaterThan(-1);
    expect(markup.indexOf("data-test-approval-control")).toBeGreaterThan(markup.indexOf("rounded-3xl bg-composer"));
    expect(markup.indexOf("data-test-approval-control")).toBeLessThan(markup.indexOf("<textarea"));
    expect(markup).not.toContain('aria-label="Thread settings"');
    expect(fixture.model).toMatchObject({ threadId: "selected", bot: { busy: false, modelSelection: { model: "thread-model" } } });
    expect(fixture.approval).toMatchObject({ approvalMode: "ask", disabled: false, trustedModesAvailable: false });
    fixture.approval!.onSelect("auto");
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "updateTask", botId: "bot", threadId: "selected", patch: { approvalMode: "auto" } });
  });

  it("keeps both controls hidden for remote clients", () => {
    window.ogb = { remoteClient: { active: true } } as NonNullable<Window["ogb"]>;
    const markup = renderToStaticMarkup(createElement(ChatView, { bot }));
    expect(markup).not.toContain("data-test-model-control");
    expect(markup).not.toContain("data-test-approval-control");
    delete window.ogb;
  });
});
