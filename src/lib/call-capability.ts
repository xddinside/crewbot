// Why this renderer cannot start a call, in the words the person needs.
//
// Three things are distinct and must stay distinct: this window is looking at
// someone else's workspace; the installed app that does support calls exists
// elsewhere; and this device's own platform does not carry the speech stack.
// Linux is the supported platform for this app, and calls are not on it yet,
// so the Linux entry says that plainly and offers the two ways forward —
// Settings → Voice, or just keep typing. Nothing here claims a capability that
// does not exist.

export type CallCapabilityHelp = {
  label: string;
  reason: string;
  action?: "choose-local-workspace" | "open-voice-settings";
};

export function callCapabilityHelp(
  capabilities: DesktopCapabilities,
  speechServiceAvailable: boolean,
): CallCapabilityHelp | null {
  if (!capabilities.dictation.available) {
    switch (capabilities.dictation.reasonCode) {
      case "remote-server":
        return {
          label: "Calls are available on This computer",
          reason:
            "You're viewing a hosted workspace. Calls use the microphone and on-device speech recognition on your Mac.",
          action: "choose-local-workspace",
        };
      case "desktop-app-required":
        return {
          label: "Calls need the macOS desktop app",
          reason: "Open this workspace in crewbot for macOS to make calls with on-device speech recognition.",
        };
      case "unsupported-platform":
        // The supported platform today is Linux, and voice calls are not on it
        // yet. Name the device and the two real ways forward rather than
        // pointing at a Mac the person may not have.
        if (capabilities.host.platform === "linux") {
          return {
            label: "Calls aren't available on this Linux device yet",
            reason:
              "Voice calls need on-device speech recognition, which the Linux app doesn't have yet. Dictation and voice replies are unavailable here too. Text chat does everything a call does.",
            action: "open-voice-settings",
          };
        }
        return {
          label: "Calls currently need macOS",
          reason: "Calls are available on macOS for now because speech recognition runs on-device.",
        };
      default:
        return {
          label: "Calls aren't available on this device",
          reason: "This device doesn't currently provide the on-device speech recognition needed for calls.",
        };
    }
  }
  if (!speechServiceAvailable) {
    return {
      label: "The call service is unavailable",
      reason: "The speech service is unavailable in this app build. Restart or update crewbot.",
    };
  }
  return null;
}