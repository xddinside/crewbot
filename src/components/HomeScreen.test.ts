// The landing is presentation, so what matters is that it presents *this*
// workspace: the user's own name, their own threads, their own goals and
// routines. These render it against a store fixture and read the markup back,
// because a landing that quietly showed a hand-written "62%" would look
// exactly right in a screenshot and be wrong in the product.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Group, Task } from "@/state/store";
import type { Routine } from "../../shared/routines";

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
    useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }),
  };
});
// The mascots animate on a rAF loop; server rendering never starts one, but
// the module still reads the host's clock and document.
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));

const { HomeScreen } = await import("./HomeScreen");

const at = (day: number, hour = 12) => new Date(2026, 2, day, hour).getTime();

const task = (over: Partial<Task> & { threadId: string }): Task => ({
  title: over.threadId,
  createdAt: at(4, 9),
  ...over,
});

const bot = (over: Partial<Bot> = {}): Bot => ({
  id: "b1",
  threadId: "t1",
  name: "Maus",
  title: "",
  description: "",
  notifications: false,
  color: "grey" as Bot["color"],
  unread: false,
  modelSelection: { instanceId: "i1", model: "m" },
  messages: [],
  ...over,
} as Bot);

/** Renders the landing against whatever `fixture.state` the test set up. The
 *  store mock reads that object, so a test states its workspace first. */
const render = (props: { bot: Bot; groups?: Group[]; routines?: Routine[] }) => {
  if (props.groups) fixture.state = { ...fixture.state, groups: props.groups };
  if (props.routines) fixture.state = { ...fixture.state, routines: props.routines };
  return renderToStaticMarkup(
    createElement(HomeScreen, {
      bot: props.bot,
      onOpenAll: () => {},
      onGoProjects: () => {},
      onShowAutomations: () => {},
      children: createElement("div", null, "conversation"),
    }),
  ).replaceAll("<!-- -->", "");
};

/** The greeting's name comes from the workspace's own profile record. */
const withProfile = (name: string) => {
  fixture.state = { ...fixture.state, config: { profile: { name, email: "" } } };
};

beforeEach(() => {
  vi.useFakeTimers();
  // 20:40 on the 4th: an evening greeting, a local day, a stable locale.
  vi.setSystemTime(at(4, 20));
  fixture.dispatch.mockClear();
  setLocale("en");
});

afterEach(() => {
  fixture.state = {};
  vi.useRealTimers();
});

describe("the greeting", () => {
  it("names the person from the profile the workspace already has", () => {
    withProfile("Nirvan Okonkwo");
    expect(render({ bot: bot() })).toContain("Good evening, Nirvan");
  });

  it("says nothing rather than saying nothing after a comma", () => {
    // No profile name yet: a dangling comma is worse than a bare salutation.
    const html = render({ bot: bot() });
    expect(html).toContain("Good evening");
    expect(html).not.toContain("Good evening,");
  });

  it("follows the clock rather than one hard-coded tone", () => {
    vi.setSystemTime(at(4, 8));
    expect(render({ bot: bot() })).toContain("Good morning");
    vi.setSystemTime(at(4, 13));
    expect(render({ bot: bot() })).toContain("Good afternoon");
  });

  it("names the assistant the user actually has", () => {
    // Nothing is renamed to fit the mockup: a workspace whose assistant is
    // called Tracker greets Tracker.
    expect(render({ bot: bot({ name: "Tracker" }) })).toContain("Your personal assistant, Tracker.");
  });
});

describe("the rail", () => {
  it("lists a thread started today and keeps an older one behind History", () => {
    const html = render({
      bot: bot({
        tasks: [
          task({ threadId: "t1", title: "Plan my week", createdAt: at(4, 9) }),
          task({ threadId: "t2", title: "Research trip", createdAt: at(1, 9) }),
        ],
      }),
    });
    expect(html).toContain("Plan my week");
    expect(html).not.toContain("Research trip");
    expect(html).toContain("History");
  });

  it("carries every visible bot into the switcher", () => {
    const html = render({
      bot: bot({
        tasks: [task({ threadId: "t1", title: "Today only", createdAt: at(4, 9) })],
      }),
    });
    // The popover is closed, but the trigger is the bot itself.
    expect(html).toContain("Maus");
    expect(html).toContain("New conversation");
  });
});

describe("Needs you", () => {
  it("carries a thread that is waiting, with its owner and status", () => {
    fixture.state = {
      bots: [
        bot({ id: "b1", name: "Maus", tasks: [task({ threadId: "t1", title: "Plan my week" })] }),
        bot({
          id: "b2",
          name: "Atlas",
          threadId: "t9",
          tasks: [{ threadId: "t9", title: "Auth permissions", createdAt: at(4, 9), activity: "waiting-on-you" }],
        }),
      ],
    };
    const html = render({ bot: bot() });
    expect(html).toContain("Auth permissions");
    expect(html).toContain("Atlas · Waiting");
  });

  it("adds a room whose member is holding the floor and waiting", () => {
    fixture.state = {
      bots: [
        bot({ id: "b1", name: "Maus", activity: "working" }),
        bot({ id: "b2", name: "Atlas", threadId: "t9", activity: "waiting-on-you" }),
      ],
      groups: [
        { id: "g1", threadId: "r1", name: "Launch", memberIds: ["b2"], defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: at(1), messages: [], busyBotId: "b2" } as Group,
      ],
    };
    const html = render({ bot: bot() });
    expect(html).toContain("Launch");
    // The room stands for its waiting member, so that member's own thread is
    // not repeated underneath it.
    expect(html).not.toContain("t9");
  });

  it("says so when nothing is waiting", () => {
    fixture.state = { bots: [bot()] };
    expect(render({ bot: bot() })).toContain("No active threads");
  });
});

describe("In motion", () => {
  it("reads the percentage off the goal run's own turn budget", () => {
    fixture.state = {
      groups: [
        {
          id: "g1",
          threadId: "r1",
          name: "Launch v1.0",
          memberIds: [],
          defaultResponder: { kind: "everyone" },
          bulletin: "",
          unread: false,
          createdAt: at(1),
          messages: [{ id: "m1", role: "assistant", at: at(4, 10), kind: "goal.run", goalRun: { runId: "x", goal: "ship", status: "working", coordinatorBotId: "b2", coordinatorName: "Atlas", turnCount: 31, maxTurns: 50, startedAt: at(4, 9) } }],
        } as unknown as Group,
      ],
    };
    const html = render({ bot: bot() });
    expect(html).toContain("Launch v1.0");
    expect(html).toContain("62%");
    expect(html).toContain('role="progressbar"');
  });

  it("drops a goal run that has already settled", () => {
    fixture.state = {
      groups: [
        {
          id: "g1",
          threadId: "r1",
          name: "Shipped",
          memberIds: [],
          defaultResponder: { kind: "everyone" },
          bulletin: "",
          unread: false,
          createdAt: at(1),
          messages: [{ id: "m1", role: "assistant", at: at(4, 10), kind: "goal.run", goalRun: { runId: "x", goal: "ship", status: "completed", coordinatorBotId: "b2", coordinatorName: "Atlas", turnCount: 50, maxTurns: 50, startedAt: at(4, 9) } }],
        } as unknown as Group,
      ],
    };
    expect(render({ bot: bot() })).toContain("No goals running.");
  });
});

describe("Today", () => {
  const routine = (over: Partial<Routine> = {}) =>
    ({
      id: "r",
      name: "Morning brief",
      prompt: "",
      target: "bot",
      botId: "b1",
      runOn: "always",
      enabled: true,
      schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      durationMinutes: 5,
      nextRunAt: null,
      createdAt: at(1),
      updatedAt: at(1),
      ...over,
    }) as Routine;

  it("carries what is still due today with its clock time", () => {
    fixture.state = { routines: [routine({ nextRunAt: at(4, 21) })] };
    const html = render({ bot: bot() });
    expect(html).toContain("Morning brief");
    expect(html).toContain(new Date(at(4, 21)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });

  it("marks a run whose time has passed as running", () => {
    fixture.state = { routines: [routine({ nextRunAt: at(4, 9) })] };
    expect(render({ bot: bot() })).toContain("Running now");
  });

  it("leaves out a routine scheduled for another day", () => {
    fixture.state = { routines: [routine({ nextRunAt: at(5, 9) })] };
    expect(render({ bot: bot() })).toContain("Nothing scheduled today.");
  });
});