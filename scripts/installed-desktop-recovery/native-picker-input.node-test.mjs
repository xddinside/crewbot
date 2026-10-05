// Opt-in native regression, separate from installed-package acceptance:
// OMB_NATIVE_PICKER_ELECTRON=/absolute/path/to/electron node --test <this file>
// Requires Xvfb, xdpyinfo, xdotool and a cleared parent desktop session.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { createFixtureEnvironment, fixtureBaseEnv, startOwnedDisplay } from "./environment.mjs";
import { chooseFolder, waitForChooserClosed, waitForFolderChooser } from "./native-picker.mjs";
import { spawnInstalledApp } from "./renderer.mjs";

const executable = process.env.OMB_NATIVE_PICKER_ELECTRON;

test("Electron's native GTK chooser accepts the exact typed folder", {
  skip: !executable,
  timeout: 30_000,
}, async () => {
  assert.ok(isAbsolute(executable), "name an explicit Electron binary");
  // This refuses the caller's desktop before making any directory or process.
  const fixture = createFixtureEnvironment(tmpdir(), "omb-native-picker-input-");
  try {
    const display = await startOwnedDisplay(fixture);
    const resultPath = join(fixture.root, "selection.json");
    const entry = join(fixture.root, "dialog.cjs");
    writeFileSync(entry, `
      const { app, BrowserWindow, dialog } = require("electron");
      const { writeFileSync } = require("node:fs");
      app.disableHardwareAcceleration();
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 1000, height: 800 });
        const result = await dialog.showOpenDialog(window, {
          title: "Choose a working folder",
          properties: ["openDirectory", "createDirectory"],
          defaultPath: ${JSON.stringify(join(fixture.root, "absent-project"))},
        });
        writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
        app.quit();
      });
    `);
    const env = {
      ...fixtureBaseEnv(fixture, { display: display.display }),
      GTK_USE_PORTAL: "0",
      // Prevent desktop service auto-discovery. This regression needs no bus.
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(fixture.runtime, "no-bus")}`,
    };
    const app = spawnInstalledApp({
      executable,
      // This synthetic Electron entrypoint tests GTK input only. The installed
      // acceptance journey continues to require the shipped Chromium sandbox.
      args: ["--no-sandbox", entry],
      env,
      logPath: join(fixture.logs, "electron.log"),
    });
    fixture.own(() => app.stop());
    const chooser = await waitForFolderChooser({ env, timeoutMs: 10_000 });
    await chooseFolder({ env, id: chooser.id, path: fixture.replacementCwd });
    await waitForChooserClosed({ env, id: chooser.id, timeoutMs: 3_000 });
    await app.stop();
    assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), {
      canceled: false,
      filePaths: [fixture.replacementCwd],
    });
  } finally {
    await fixture.stop();
  }
});
