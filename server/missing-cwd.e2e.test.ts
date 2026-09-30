import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("names a deleted working folder during a real isolated turn", async () => {
  const fixture = await launchVerificationServer();
  const cwd = mkdtempSync(join(tmpdir(), "crewbot-missing-cwd-"));
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  try {
    const { bot } = await control(["new-bot", "--name", "Missing folder fixture"]);
    const patch = await fetch(`${fixture.info.url}/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    expect(patch.ok, await patch.text()).toBe(true);
    rmSync(cwd, { recursive: true });

    await control(["send", "--bot", bot.id, "--text", "Reply with hello"]);
    const wait = await control(["wait", "--bot", bot.id, "--timeout", "30"]);
    const messages = await control(["messages", "--bot", bot.id, "--limit", "10"]);
    const error = messages.messages.find((message: any) => message.role === "bot" && message.kind === "activity" && message.tool?.ok === false);

    expect(wait.status).toBe("failed");
    expect(error?.tool).toMatchObject({ name: `error: the working folder no longer exists: ${cwd}`, ok: false });
    expect(error.tool.setup).not.toBe(true);
    expect(wait.target.activity).toBe("idle");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await fixture.close();
  }
}, 60_000);
