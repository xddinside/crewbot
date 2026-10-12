import { describe, expect, it } from "vitest";

import type { Bot, Message, Task } from "@/state/store";
import { botPreview, botSignals, crewRoster, crewTeamOrder, specialistCount } from "./crew-roster";

const bot = (over: Partial<Bot> & { id: string }): Bot =>
  ({
    threadId: `${over.id}-t`,
    name: over.id,
    title: "",
    description: "",
    notifications: false,
    color: "grey",
    unread: false,
    modelSelection: { instanceId: "i1", model: "m" },
    messages: [],
    ...over,
  }) as Bot;

const message = (over: Partial<Message> & { id: string }): Message =>
  ({ role: "assistant", at: 1, text: "", ...over }) as Message;

describe("teams", () => {
  it("follows the saved section order, then teams only a bot implies", () => {
    const bots = [
      bot({ id: "wrench", section: "Workshop" }),
      bot({ id: "atlas", section: "Engineering" }),
      bot({ id: "tracker" }),
    ];
    expect(crewTeamOrder(bots, ["Engineering", "Empty"])).toEqual([
      "Engineering",
      "Workshop",
      "",
    ]);
  });

  it("does not make a column out of a saved section with no bots", () => {
    // An empty team is a thing the team map creates and the roster has
    // nothing to show for.
    const columns = crewRoster({ bots: [bot({ id: "atlas" })], sections: ["Empty"], generalLabel: "General" });
    expect(columns.map((column) => column.label)).toEqual(["General"]);
  });
});

describe("the roster", () => {
  const workspace = {
    bots: [
      bot({ id: "atlas", name: "Atlas", title: "Engineering", section: "Engineering", chiefOfStaff: true }),
      bot({ id: "forge", name: "Forge", title: "Implementation", section: "Engineering" }),
      bot({ id: "nova", name: "Nova", title: "Marketing", section: "Marketing", chiefOfStaff: true }),
      bot({ id: "tracker", name: "Tracker", title: "Assistant" }),
    ],
    sections: ["Engineering", "Marketing"],
    generalLabel: "General",
  };

  it("heads each team with its Chief and lists the rest underneath", () => {
    const columns = crewRoster(workspace);
    expect(columns.map((column) => column.label)).toEqual(["Engineering", "Marketing", "General"]);
    expect(columns[0].lead?.name).toBe("Atlas");
    expect(columns[0].specialists.map((b) => b.name)).toEqual(["Forge"]);
    // No Chief was appointed for General, so the column says so by having
    // none rather than promoting Tracker.
    expect(columns[2].lead).toBeNull();
    expect(columns[2].members.map((b) => b.name)).toEqual(["Tracker"]);
  });

  it("counts the specialists a lead actually has", () => {
    const [engineering] = crewRoster(workspace);
    expect(specialistCount(engineering)).toBe(1);
    const general = crewRoster(workspace).at(-1)!;
    expect(specialistCount(general)).toBe(1);
  });

  it("keeps a team with no Chief at all", () => {
    const columns = crewRoster({
      bots: [bot({ id: "solo", section: "Solo" })],
      sections: ["Solo"],
      generalLabel: "General",
    });
    expect(columns).toHaveLength(1);
    expect(columns[0].lead).toBeNull();
    expect(columns[0].members.map((b) => b.id)).toEqual(["solo"]);
  });

  it("filters the roster without renaming or dropping teams", () => {
    const columns = crewRoster({ ...workspace, query: "forge" });
    expect(columns).toHaveLength(1);
    expect(columns[0].label).toBe("Engineering");
    expect(columns[0].members.map((b) => b.name)).toEqual(["Forge"]);
    // A filter that matches nothing leaves an empty roster, not a page of
    // every team with nothing in it.
    expect(crewRoster({ ...workspace, query: "zzz" })).toEqual([]);
  });

  it("matches a title and a description, not only a name", () => {
    expect(crewRoster({ ...workspace, query: "marketing" })[0].label).toBe("Marketing");
    expect(
      crewRoster({
        ...workspace,
        bots: [bot({ id: "probe", description: "Runs the test suite" })],
        sections: [],
      }).map((column) => column.members.map((b) => b.id)),
    ).toEqual([["probe"]]);
  });

  it("leaves archived bots out of the roster entirely", () => {
    const columns = crewRoster({
      ...workspace,
      bots: [...workspace.bots, bot({ id: "old", section: "Engineering", hidden: true })],
    });
    expect(columns[0].total).toBe(2);
    expect(columns[0].members.map((b) => b.id)).not.toContain("old");
  });
});

describe("signals", () => {
  const task = (over: Partial<Task> & { threadId: string }): Task => ({ title: "t", createdAt: 0, ...over });

  it("prefers waiting over working, and working over queued", () => {
    const waiting = botSignals(
      bot({ id: "a", busy: true, activity: "waiting-on-you", tasks: [task({ threadId: "t", busy: true })] }),
      { t: [{}] },
    );
    expect(waiting).toMatchObject({ waiting: true, working: false, queued: true });

    const working = botSignals(bot({ id: "a", busy: true }), { "a-t": [{}] });
    expect(working).toMatchObject({ waiting: false, working: true, queued: true });
  });

  it("folds the signals up from every thread, not just the open one", () => {
    const signals = botSignals(
      bot({
        id: "a",
        tasks: [task({ threadId: "t1" }), task({ threadId: "t2", unread: true, activity: "working" })],
      }),
    );
    expect(signals).toMatchObject({ working: true, unread: true });
  });

  it("carries a dead or signal-less bot as offline, not as idle", () => {
    expect(botSignals(bot({ id: "a", activity: "no-signal" })).offline).toBe(true);
    expect(botSignals(bot({ id: "a", activity: "dead" })).offline).toBe(true);
    expect(botSignals(bot({ id: "a" })).offline).toBe(false);
  });

  it("ignores a routine's own execution thread", () => {
    const signals = botSignals(
      bot({ id: "a", tasks: [task({ threadId: "r1", routineRunId: "run-1", unread: true, activity: "working" })] }),
    );
    expect(signals.unread).toBe(false);
    expect(signals.working).toBe(false);
  });
});

describe("the preview line", () => {
  it("reads the tail of the visible branch", () => {
    expect(
      botPreview(
        bot({
          id: "a",
          messages: [
            message({ id: "m1", text: "old branch" }),
            message({ id: "m2", text: "latest" }),
          ],
        }),
      ),
    ).toBe("latest");
  });

  it("says nothing while the bot is working or waiting", () => {
    // The dot beside the name already says this; a half-written line next to
    // it reads as a settled message.
    expect(botPreview(bot({ id: "a", busy: true, messages: [message({ id: "m1", text: "hi" })] }))).toBe("");
    expect(
      botPreview(
        bot({ id: "a", activity: "waiting-on-you", messages: [message({ id: "m1", text: "hi" })] }),
      ),
    ).toBe("");
  });

  it("names who wrote a peer line rather than dropping it", () => {
    expect(
      botPreview(
        bot({
          id: "a",
          messages: [message({ id: "m1", role: "user", peerAsk: { botId: "b2", name: "Atlas" }, text: "ping" })],
        }),
      ),
    ).toContain("Atlas");
  });
});