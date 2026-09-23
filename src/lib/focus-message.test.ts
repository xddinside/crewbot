import { afterEach, describe, expect, it, vi } from "vitest";

import { landOnSearchHit } from "./focus-message";
import type { SearchHit } from "./search-hit";
import {
  initialState,
  reducer,
  type AppState,
  type Bot,
  type Group,
  type Message,
} from "@/state/store";

const message = (id: string): Message => ({ id, at: 1, role: "user", kind: "text", text: id });

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    botId: "bot-1",
    name: "Pepper",
    threadId: "thread-1",
    messageId: "hit-1",
    role: "user",
    kind: "text",
    at: 1,
    snippet: "hit",
    matchStart: 0,
    matchLength: 3,
    onActivePath: true,
    ...overrides,
  };
}

describe("landOnSearchHit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a bounded centered page for an older hit in the selected direct thread", async () => {
    const bot = { id: "bot-1", threadId: "thread-1", messages: [message("tail")] } as never as Bot;
    const state: AppState = { ...initialState, bots: [bot] };
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return response({ messages: [message("before"), message("hit-1")], activeLeafId: "hit-1", hasMore: true });
    });
    let next = state;

    await landOnSearchHit(hit(), state, (action) => { next = reducer(next, action); });

    expect(requests).toEqual([{
      url: "/api/threads/thread-1/messages?around=hit-1&limit=200",
      method: "GET",
    }]);
    expect(next.bots[0].messages.map((item) => item.id)).toEqual(["before", "hit-1"]);
    expect(next.focusMessage).toMatchObject({ threadId: "thread-1", messageId: "hit-1" });
  });

  it("bounds direct task switches and selects an off-path hit before loading its window", async () => {
    const bot = { id: "bot-1", threadId: "current", messages: [message("current")] } as never as Bot;
    const state: AppState = { ...initialState, bots: [bot] };
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (url.includes("/tasks/thread-1?messages=200")) {
        return response({ bot: { ...bot, threadId: "thread-1", messages: [message("tail")] } });
      }
      if (url.endsWith("/active-branch")) return response({ activeLeafId: "hit-leaf" });
      return response({ messages: [message("hit-1"), message("hit-leaf")], activeLeafId: "old-leaf", hasMore: true });
    });
    let next = state;

    await landOnSearchHit(hit({ onActivePath: false }), state, (action) => { next = reducer(next, action); });

    expect(requests.map(({ url, method }) => [method, url])).toEqual([
      ["POST", "/api/bots/bot-1/tasks/thread-1?messages=200"],
      ["POST", "/api/bots/bot-1/active-branch"],
      ["GET", "/api/threads/thread-1/messages?around=hit-1&limit=200"],
    ]);
    expect(JSON.parse(requests[1].body ?? "{}")).toEqual({ messageId: "hit-1" });
    expect(next.bots[0].activeLeafId).toBe("hit-leaf");
    expect(next.bots[0].messages.map((item) => item.id)).toEqual(["hit-1", "hit-leaf"]);
  });

  it("fetches a bounded centered page for an older hit in the selected group", async () => {
    const group = { id: "group-1", threadId: "group-thread", messages: [message("tail")] } as never as Group;
    const state: AppState = { ...initialState, groups: [group] };
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return response({ messages: [message("before"), message("hit-1")], activeLeafId: "hit-1", hasMore: true });
    });
    let next = state;

    await landOnSearchHit(hit({ botId: undefined, groupId: "group-1", threadId: "group-thread" }), state,
      (action) => { next = reducer(next, action); });

    expect(requests).toEqual(["/api/threads/group-thread/messages?around=hit-1&limit=200"]);
    expect(next.groups[0].messages.map((item) => item.id)).toEqual(["before", "hit-1"]);
  });

  it("bounds group task switches before loading the centered message window", async () => {
    const group = { id: "group-1", threadId: "current", messages: [message("current")] } as never as Group;
    const state: AppState = { ...initialState, groups: [group] };
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/tasks/group-thread?messages=200")) {
        return response({ group: { ...group, threadId: "group-thread", messages: [message("tail")] } });
      }
      return response({ messages: [message("hit-1")], activeLeafId: "hit-1", hasMore: true });
    });
    let next = state;

    await landOnSearchHit(hit({ botId: undefined, groupId: "group-1", threadId: "group-thread" }), state,
      (action) => { next = reducer(next, action); });

    expect(requests).toEqual([
      { url: "/api/groups/group-1/tasks/group-thread?messages=200", method: "POST" },
      { url: "/api/threads/group-thread/messages?around=hit-1&limit=200", method: "GET" },
    ]);
    expect(next.groups[0].messages.map((item) => item.id)).toEqual(["hit-1"]);
  });
});
