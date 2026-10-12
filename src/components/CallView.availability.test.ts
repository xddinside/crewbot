import { describe, expect, it } from "vitest";

import { callCapabilityHelp } from "@/lib/call-capability";

function capabilities(
  dictation: DesktopCapabilities["dictation"],
  platform: DesktopCapabilities["host"]["platform"] = "darwin",
): DesktopCapabilities {
  return {
    host: {
      platform,
      label: "macOS",
      session: "unknown",
      packaged: true,
    },
    windowChrome: "mac-inset",
    screenPreview: { available: true, interaction: "direct" },
    dictation,
    localComputer: {
      available: true,
      support: "supported",
      enabled: true,
      status: "ready",
    },
  };
}

describe("call capability guidance", () => {
  it("keeps a local Mac call available when the native speech service exists", () => {
    expect(callCapabilityHelp(capabilities({
      available: true,
      engine: "apple-speech",
      onDevice: true,
    }), true)).toBeNull();
  });

  it("sends a hosted workspace view to the native workspace menu", () => {
    expect(callCapabilityHelp(capabilities({
      available: false,
      engine: "none",
      onDevice: false,
      reasonCode: "remote-server",
    }), false)).toEqual({
      label: "Calls are available on This computer",
      reason: "You're viewing a hosted workspace. Calls use the microphone and on-device speech recognition on your Mac.",
      action: "choose-local-workspace",
    });
  });

  it("tells a browser user to open the installed macOS app", () => {
    const help = callCapabilityHelp(capabilities({
      available: false,
      engine: "none",
      onDevice: false,
      reasonCode: "desktop-app-required",
    }), false);
    expect(help?.label).toBe("Calls need the macOS desktop app");
    expect(help).not.toHaveProperty("action");
  });

  it("explains that native calls are not supported on a non-Mac desktop", () => {
    const help = callCapabilityHelp(capabilities({
      available: false,
      engine: "none",
      onDevice: false,
      reasonCode: "unsupported-platform",
    }, "win32"), false);
    expect(help?.label).toBe("Calls currently need macOS");
    expect(help).not.toHaveProperty("action");
  });

  // Linux is the platform this app supports. Voice is not on it yet, so the
  // entry names this device, says text chat still works, and offers the one
  // place a person could look — rather than pointing at a Mac.
  it("names this Linux device and offers a setup route instead of another platform", () => {
    const help = callCapabilityHelp(capabilities({
      available: false,
      engine: "none",
      onDevice: false,
      reasonCode: "unsupported-platform",
    }, "linux"), false);
    expect(help?.label).toBe("Calls aren't available on this Linux device yet");
    expect(help?.reason).toContain("Text chat does everything a call does");
    expect(help).not.toHaveProperty("reason", expect.stringContaining("macOS"));
    expect(help?.action).toBe("open-voice-settings");
  });

  it("distinguishes a broken local speech service from an unsupported device", () => {
    expect(callCapabilityHelp(capabilities({
      available: true,
      engine: "apple-speech",
      onDevice: true,
    }), false)).toEqual({
      label: "The call service is unavailable",
      reason: "The speech service is unavailable in this app build. Restart or update crewbot.",
    });
  });
});
