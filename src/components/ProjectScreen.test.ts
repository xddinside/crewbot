// Projects is presentation, so what matters is that it presents *this*
// workspace: the user's own rooms, their own conversations, their own goal
// run and their own roster. These render it against a store fixture and read
// the markup back, because a column that quietly showed a hand-written "62%"
// would look exactly right in a screenshot and be wrong in the product.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("navigator", { language: "en" });
  return { dispatch: vi.fn(), state: {} as Record<string, unknown> };
});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, ...fixture.state },
      dispatch: fixture.dispatch,
    }),
  };
});
// The mascots animate on a rAF loop; server rendering never starts one, but
// the module still reads the host's clock and document.
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
// The membership sheet tracks analytics, and the tracker wants a real DOM.
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { ProjectScreen } = await import("./ProjectScreen");

const bot = (over: Partial<Bot> = {}): Bot =>
  ({
    id: "b1",
    threadId: "bt-1",
    name: "Atlas",
    title: "",
    description: "",
    notifications: false,
    color: "green" as Bot["color"],
    unread: false,
    modelSelection: { instanceId: "i1", model: "m" },
    messages: [],
    ...over,
  }) as Bot;

const group = (over: Partial<Group> = {}): Group =>
  ({
    id: "room-launch",
    threadId: "gt-2",
    name: "Launch v1.0",
    memberIds: ["b1"],
    defaultResponder: { kind: "member", botId: "b1" },
    bulletin: "",
    unread: false,
    createdAt: 1,
    messages: [],
    ...over,
  }) as Group;

const goalMessage = (
  over: Partial<NonNullable<Message["goalRun"]>> = {},
): Message => ({
  id: "g1",
  role: "bot",
  kind: "goal.run",
  at: 2,
  goalRun: {
    runId: "run-1",
    goal: "Public beta by Nov 15",
    status: "working",
    coordinatorBotId: "b1",
    coordinatorName: "Atlas",
    turnCount: 5,
    maxTurns: 8,
    startedAt: 1,
    ...over,
  },
});

const render = (props: {
  group: Group;
  bots?: Bot[];
  groups?: Group[];
  pendingQueued?: Record<string, unknown[]>;
}) => {
  fixture.state = {
    ...fixture.state,
    bots: props.bots ?? [bot()],
    groups: props.groups ?? [props.group],
    selectedId: props.group.id,
    pendingQueued: props.pendingQueued ?? {},
  };
  return renderToStaticMarkup(
    createElement(ProjectScreen, {
      group: props.group,
      onOpenAll: () => {},
      children: createElement("div", null, "conversation"),
    }),
  ).replaceAll("<!-- -->", "");
};

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = {};
  setLocale("en");
});

afterEach(() => {
  fixture.state = {};
});

describe("the project list", () => {
  it("lists the room's own conversations under the room", () => {
    const room = group({
      tasks: [
        { threadId: "gt-1", title: "Website redesign", createdAt: 1 },
        { threadId: "gt-2", title: "Investor update", createdAt: 2 },
      ],
    });
    const markup = render({ group: room, groups: [room] });
    expect(markup).toContain("Launch v1.0");
    expect(markup).toContain("Website redesign");
    expect(markup).toContain("Investor update");
    // the selected project, marked as the current page for assistive tech
    expect(markup).toContain('aria-current="page"');
  });

  it("leaves the bot⇄bot channel out of the project list", () => {
    const room = group();
    const channel = group({ id: "room-dm", name: "Atlas ⇄ Probe", dm: true });
    const markup = render({ group: room, groups: [room, channel] });
    expect(markup).not.toContain("Atlas ⇄ Probe");
  });

  it("keeps the whole workspace one click away", () => {
    const room = group();
    const markup = render({ group: room });
    expect(markup).toContain("All conversations");
    // the guided tour anchors on the same control (F134)
    expect(markup).toContain('data-tour="tools"');
  });

  it("offers New project through the same form the sidebar uses", () => {
    const room = group();
    expect(render({ group: room })).toContain("New project");
  });
});

describe("the project context column", () => {
  it("reads the goal bar off the room's own goal run", () => {
    const room = group({ messages: [goalMessage()] });
    const markup = render({ group: room });
    expect(markup).toContain("Public beta by Nov 15");
    expect(markup).toContain("63%");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="63"');
  });

  it("says nothing about a goal when the room has never run one", () => {
    const markup = render({ group: group() });
    expect(markup).not.toContain('role="progressbar"');
  });

  it("names the member holding the floor under Up next", () => {
    const room = group({ busyBotId: "b1", working: true });
    const markup = render({
      group: room,
      bots: [bot({ activity: "working" })],
    });
    expect(markup).toContain("Up next");
    expect(markup).toContain("Atlas");
  });

  it("counts the words waiting on a conversation rather than inventing a to-do", () => {
    const room = group({
      tasks: [
        { threadId: "gt-1", title: "Website redesign", createdAt: 1 },
        { threadId: "gt-2", title: "Investor update", createdAt: 2 },
      ],
    });
    const markup = render({
      group: room,
      pendingQueued: { "gt-1": [{ queueId: "q" }, { queueId: "q2" }] },
    });
    expect(markup).toContain("2 queued");
  });

  it("shows the roster's size, not a mockup's number", () => {
    const room = group({ memberIds: ["b1", "b2"] });
    const markup = render({
      group: room,
      bots: [bot(), bot({ id: "b2", name: "Probe" })],
    });
    expect(markup).toContain("Staffing");
    // the avatars are stubbed out of the markup, so the count is the assertion
    expect(markup).toMatch(/Staffing<\/span><span[^>]*>2</);
  });
});

describe("what the frame does not take over", () => {
  it("renders the conversation it is handed, and nothing else in the middle", () => {
    const room = group();
    const markup = render({ group: room });
    expect(markup).toContain("conversation");
    // the columns float on the sky: only the conversation carries the panel
    expect(markup).toContain('data-project-rail=""');
    expect(markup).toContain('data-project-context=""');
  });
});
