import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("recovers a missing working folder in the same task without losing its transcript", async () => {
  let fixture = await launchVerificationServer();
  const firstUseCwd = mkdtempSync(join(tmpdir(), "crewbot-first-use-cwd-"));
  const firstUseRetryCwd = mkdtempSync(join(tmpdir(), "crewbot-first-use-retry-"));
  const resumedCwd = mkdtempSync(join(tmpdir(), "crewbot-resumed-cwd-"));
  const resumedRetryCwd = mkdtempSync(join(tmpdir(), "crewbot-resumed-retry-"));
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const taskCwd = async (botId: string, threadId: string) => {
    const state = await fetch(`${fixture.info.url}/api/bots?messages=0`).then((response) => response.json()) as any;
    return state.bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId)?.cwd;
  };
  const storedTask = (botId: string, threadId: string) => {
    const state = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8")) as any[];
    return state.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId);
  };

  const restartAndRetry = async (botId: string, threadId: string, failedUser: any, failedError: any, cwd: string) => {
    const restart = await fetch(`${fixture.info.url}/api/bots/${botId}/tasks/${threadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restartAtCwd: cwd,
        expectedErrorMessageId: failedError.id,
        expectedUserMessageId: failedUser.id,
      }),
    });
    expect(restart.status, await restart.clone().text()).toBe(200);
    const body = await restart.json() as any;
    expect(body.task.cwd).toBe(cwd);
    expect(body.bot.threadId).toBe(threadId);
    expect(storedTask(botId, threadId).resumeCursors).toEqual({});
    expect(storedTask(botId, threadId).lastInstanceId).toBeUndefined();
    expect(storedTask(botId, threadId).handedMessages).toEqual({});

    const beforeRetry = await control(["messages", "--bot", botId, "--limit", "20"]);
    expect(beforeRetry.messages.some((message: any) => message.id === failedUser.id)).toBe(true);
    const retry = await fetch(`${fixture.info.url}/api/bots/${botId}/messages/${failedUser.id}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: failedUser.text, threadId }),
    });
    expect(retry.status, await retry.clone().text()).toBe(202);
    const wait = await control(["wait", "--bot", botId, "--task", threadId, "--timeout", "30"]);
    const afterRetry = await control(["messages", "--bot", botId, "--limit", "20"]);
    expect(wait.status, JSON.stringify({ target: wait.target, messages: wait.messages?.slice(-5) })).toBe("settled");
    expect(wait.target.activity).toBe("idle");
    expect(afterRetry.messages.some((message: any) => message.role === "bot" && message.kind === "text")).toBe(true);
    expect(wait.taskId).toBe(threadId);
  };

  try {
    const firstUse = await control(["new-bot", "--name", "First-use folder fixture"]);
    const firstUsePatch = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: firstUseCwd }),
    });
    expect(firstUsePatch.ok, await firstUsePatch.text()).toBe(true);
    rmSync(firstUseCwd, { recursive: true });

    await control(["send", "--bot", firstUse.bot.id, "--text", "Reply with hello"]);
    const firstUseWait = await control(["wait", "--bot", firstUse.bot.id, "--timeout", "30"]);
    const firstUseMessages = await control(["messages", "--bot", firstUse.bot.id, "--limit", "10"]);
    const firstUseUser = firstUseMessages.messages.find((message: any) => message.role === "user");
    const firstUseError = firstUseMessages.messages.find((message: any) => message.role === "bot" && message.kind === "activity" && message.tool?.ok === false);
    expect(firstUseWait.status).toBe("failed");
    expect(firstUseUser).toBeDefined();
    expect(await taskCwd(firstUse.bot.id, firstUse.bot.activeTaskId)).toBeUndefined();
    expect(firstUseError?.tool.name).toBe(`error: the working folder no longer exists: ${firstUseCwd}`);
    expect(firstUseError.tool.setup).not.toBe(true);
    expect(firstUseWait.target.activity).toBe("idle");

    const unboundRestart = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}/tasks/${firstUse.bot.activeTaskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restartAtCwd: firstUseRetryCwd }),
    });
    expect(unboundRestart.status).toBe(400);
    expect(await taskCwd(firstUse.bot.id, firstUse.bot.activeTaskId)).toBeUndefined();

    const invalidRestart = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}/tasks/${firstUse.bot.activeTaskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restartAtCwd: join(firstUseCwd, "missing-child"),
        expectedErrorMessageId: firstUseError.id,
        expectedUserMessageId: firstUseUser.id,
      }),
    });
    expect(invalidRestart.status).toBe(400);
    expect(await taskCwd(firstUse.bot.id, firstUse.bot.activeTaskId)).toBeUndefined();

    // A profile folder change is a separate supported path. It leaves the
    // failed row on the active branch while allowing a later turn to settle,
    // which reproduces a picker result arriving after accepted newer work.
    const profileFolder = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: firstUseRetryCwd }),
    });
    expect(profileFolder.ok, await profileFolder.text()).toBe(true);
    await control(["send", "--bot", firstUse.bot.id, "--text", "Complete newer work before old recovery arrives"]);
    const newerWait = await control(["wait", "--bot", firstUse.bot.id, "--timeout", "30"]);
    expect(newerWait.status).toBe("settled");
    expect(newerWait.target.activity).toBe("idle");
    const activeMessages = await control(["messages", "--bot", firstUse.bot.id, "--limit", "20"]);
    expect(activeMessages.messages.some((message: any) => message.id === firstUseError.id)).toBe(true);
    const newerProviderState = storedTask(firstUse.bot.id, firstUse.bot.activeTaskId);
    expect(Object.keys(newerProviderState.resumeCursors).length).toBeGreaterThan(0);
    const staleRecovery = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}/tasks/${firstUse.bot.activeTaskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restartAtCwd: resumedRetryCwd,
        expectedErrorMessageId: firstUseError.id,
        expectedUserMessageId: firstUseUser.id,
      }),
    });
    expect(staleRecovery.status).toBe(409);
    const afterStaleRecovery = storedTask(firstUse.bot.id, firstUse.bot.activeTaskId);
    expect(await taskCwd(firstUse.bot.id, firstUse.bot.activeTaskId)).toBe(firstUseRetryCwd);
    expect(afterStaleRecovery.resumeCursors).toEqual(newerProviderState.resumeCursors);
    expect(afterStaleRecovery.lastInstanceId).toBe(newerProviderState.lastInstanceId);
    expect(afterStaleRecovery.handedMessages).toEqual(newerProviderState.handedMessages);

    const resumed = await control(["new-bot", "--name", "Resumed session folder fixture"]);
    const resumedPatch = await fetch(`${fixture.info.url}/api/bots/${resumed.bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: resumedCwd }),
    });
    expect(resumedPatch.ok, await resumedPatch.text()).toBe(true);
    await control(["send", "--bot", resumed.bot.id, "--text", "Create a provider session"]);
    expect((await control(["wait", "--bot", resumed.bot.id, "--timeout", "30"])).status).toBe("settled");

    const resumedThreadId = resumed.bot.activeTaskId;
    const priorProviderState = storedTask(resumed.bot.id, resumedThreadId);
    expect(Object.keys(priorProviderState.resumeCursors).length).toBeGreaterThan(0);
    expect(priorProviderState.lastInstanceId).toBeDefined();
    const beforeDelete = await control(["messages", "--bot", resumed.bot.id, "--limit", "20"]);
    const priorUser = beforeDelete.messages.find((message: any) => message.role === "user");
    expect(priorUser?.text).toBe("Create a provider session");
    // Stop the owned fixture to release its provider child's cwd handle, then
    // restart on the same data. The persisted task is still a previously
    // running task, while removing its folder is now valid on Windows too.
    const dataDir = fixture.info.dataDir;
    await fixture.stop();
    rmSync(resumedCwd, { recursive: true, maxRetries: 10, retryDelay: 100 });
    fixture = await launchVerificationServer(
      process.env, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { dataDir },
    );

    await control(["send", "--bot", resumed.bot.id, "--text", "Reply after the folder is gone"]);
    const resumedWait = await control(["wait", "--bot", resumed.bot.id, "--timeout", "30"]);
    const resumedMessages = await control(["messages", "--bot", resumed.bot.id, "--limit", "20"]);
    const resumedUser = [...resumedMessages.messages].reverse().find((message: any) => message.role === "user");
    const resumedError = resumedMessages.messages.find((message: any) => message.role === "bot" && message.kind === "activity" && message.tool?.ok === false);
    expect(resumedWait.status).toBe("failed");
    expect(resumedWait.target.activity).toBe("idle");
    expect(resumedMessages.messages.some((message: any) => message.id === priorUser.id)).toBe(true);
    expect(resumedUser).toBeDefined();
    expect(resumedError?.tool.name).toBe(`error: the working folder no longer exists: ${resumedCwd}`);
    expect(await taskCwd(resumed.bot.id, resumedThreadId)).toBe(resumedCwd);
    expect(storedTask(resumed.bot.id, resumedThreadId).resumeCursors).toEqual(priorProviderState.resumeCursors);
    await restartAndRetry(resumed.bot.id, resumedThreadId, resumedUser, resumedError, resumedRetryCwd);
  } finally {
    try {
      await fixture.close();
    } finally {
      for (const cwd of [firstUseCwd, firstUseRetryCwd, resumedCwd, resumedRetryCwd]) {
        rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }
}, 120_000);

it("refuses to restart a task while its provider session is live", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const cwd = mkdtempSync(join(tmpdir(), "crewbot-live-cwd-"));
  const replacementCwd = mkdtempSync(join(tmpdir(), "crewbot-live-replacement-"));
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const taskCwd = async (botId: string, threadId: string) => {
    const state = await fetch(`${fixture.info.url}/api/bots?messages=0`).then((response) => response.json()) as any;
    return state.bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId)?.cwd;
  };

  try {
    const { bot } = await control(["new-bot", "--name", "Live session fixture"]);
    const threadId = bot.activeTaskId;
    const profile = await fetch(`${fixture.info.url}/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    expect(profile.ok, await profile.text()).toBe(true);
    await control(["send", "--bot", bot.id, "--text", "Keep this provider session live"]);

    let busy = false;
    let observedState: any;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const state = await fetch(`${fixture.info.url}/api/bots?messages=0`).then((response) => response.json()) as any;
      observedState = state.bots.find((candidate: any) => candidate.id === bot.id)?.tasks.find((task: any) => task.threadId === threadId);
      busy = Boolean(state.bots.find((candidate: any) => candidate.id === bot.id)?.tasks.find((task: any) => task.threadId === threadId)?.busy);
      if (busy) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(busy, JSON.stringify(observedState)).toBe(true);

    const restart = await fetch(`${fixture.info.url}/api/bots/${bot.id}/tasks/${threadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restartAtCwd: replacementCwd,
        expectedErrorMessageId: "prior-folder-error",
        expectedUserMessageId: "prior-user-turn",
      }),
    });
    expect(restart.status, await restart.clone().text()).toBe(409);
    const restartBody = await restart.json() as { error: string };
    expect(restartBody.error).toContain("stop this thread");
    expect(await taskCwd(bot.id, threadId)).toBe(cwd);

    await control(["interrupt", "--bot", bot.id]);
    await control(["wait", "--bot", bot.id, "--timeout", "30"]);
  } finally {
    try {
      await fixture.close();
    } finally {
      for (const path of [cwd, replacementCwd]) {
        rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  }
}, 90_000);
