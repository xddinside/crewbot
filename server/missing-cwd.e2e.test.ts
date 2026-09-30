import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("recovers a missing working folder in the same task without losing its transcript", async () => {
  const fixture = await launchVerificationServer();
  const firstUseCwd = mkdtempSync(join(tmpdir(), "crewbot-first-use-cwd-"));
  const firstUseRetryCwd = mkdtempSync(join(tmpdir(), "crewbot-first-use-retry-"));
  const resumedCwd = mkdtempSync(join(tmpdir(), "crewbot-resumed-cwd-"));
  const resumedRetryCwd = mkdtempSync(join(tmpdir(), "crewbot-resumed-retry-"));
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const taskCwd = async (botId: string, threadId: string) => {
    const state = await fetch(`${fixture.info.url}/api/bots?messages=0`).then((response) => response.json()) as any;
    return state.bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId)?.cwd;
  };

  const restartAndRetry = async (botId: string, threadId: string, failedUser: any, cwd: string) => {
    const restart = await fetch(`${fixture.info.url}/api/bots/${botId}/tasks/${threadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restartAtCwd: cwd }),
    });
    expect(restart.status, await restart.clone().text()).toBe(200);
    const body = await restart.json() as any;
    expect(body.task.cwd).toBe(cwd);
    expect(body.bot.threadId).toBe(threadId);

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

    const invalidRestart = await fetch(`${fixture.info.url}/api/bots/${firstUse.bot.id}/tasks/${firstUse.bot.activeTaskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restartAtCwd: join(firstUseCwd, "missing-child") }),
    });
    expect(invalidRestart.status).toBe(400);
    expect(await taskCwd(firstUse.bot.id, firstUse.bot.activeTaskId)).toBeUndefined();
    await restartAndRetry(firstUse.bot.id, firstUse.bot.activeTaskId, firstUseUser, firstUseRetryCwd);

    const resumed = await control(["new-bot", "--name", "Resumed session folder fixture"]);
    const resumedPatch = await fetch(`${fixture.info.url}/api/bots/${resumed.bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: resumedCwd }),
    });
    expect(resumedPatch.ok, await resumedPatch.text()).toBe(true);
    await control(["send", "--bot", resumed.bot.id, "--text", "Create a provider session"]);
    expect((await control(["wait", "--bot", resumed.bot.id, "--timeout", "30"])).status).toBe("settled");

    rmSync(resumedCwd, { recursive: true });
    await control(["send", "--bot", resumed.bot.id, "--text", "Reply after the folder is gone"]);
    const resumedWait = await control(["wait", "--bot", resumed.bot.id, "--timeout", "30"]);
    const resumedMessages = await control(["messages", "--bot", resumed.bot.id, "--limit", "20"]);
    const resumedUser = [...resumedMessages.messages].reverse().find((message: any) => message.role === "user");
    const resumedError = resumedMessages.messages.find((message: any) => message.role === "bot" && message.kind === "activity" && message.tool?.ok === false);
    expect(resumedWait.status).toBe("failed");
    expect(resumedUser).toBeDefined();
    expect(await taskCwd(resumed.bot.id, resumed.bot.activeTaskId)).toBe(resumedCwd);
    expect(resumedError?.tool.name).toBe(`error: the working folder no longer exists: ${resumedCwd}`);
    await restartAndRetry(resumed.bot.id, resumed.bot.activeTaskId, resumedUser, resumedRetryCwd);
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
      body: JSON.stringify({ restartAtCwd: replacementCwd }),
    });
    expect(restart.status).toBe(409);
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
