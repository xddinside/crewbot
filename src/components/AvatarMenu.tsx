// Your avatar, and everything that is about the app rather than about what
// you are looking at.
//
// The same menu the sidebar's profile row opens, lifted to the top bar and
// widened: with the three main destinations in the pill, this is where the
// secondary ones live — Automations, Apps & tools, Settings, Help, and the
// update check. Nothing that used to be one click from the sidebar is more
// than one click now.
//
// The menu chrome is the existing `SidebarPopoverMenu`, so keyboard handling,
// the outside-click close and focus return are the behaviour they already
// had. Only the trigger's shape changes. The update entry is the same hook the
// sidebar uses, so it reports progress in one place or the other, never two.

import { CalendarDays, HelpCircle, Keyboard, Puzzle, Settings as SettingsIcon, Smartphone } from "lucide-react";
import { InitialsAvatar } from "./Avatar";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { phoneSettingsAction, useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { HELP_CENTER_URL, openExternalLink } from "@/lib/app-links";
import { useCaptionChrome } from "./DesktopCapabilities";
import { profileInitials, profileLabel, useUpdateItem } from "./SidebarProfileMenu";

export function AvatarMenu() {
  const { state, dispatch } = useStore();
  const { noDragStyle } = useCaptionChrome();
  const phone = useSidebarPhoneStatus();
  const update = useUpdateItem();
  const profile = state.config?.profile;
  const name = profileLabel(profile);

  const items: SidebarMenuItem[] = [
    {
      key: "automations",
      label: t("sidebar.nav.automations"),
      icon: <CalendarDays size={18} />,
      active: state.activeView === "routines",
      // folded into a menu, a failed run would otherwise vanish with the row
      attention: state.routineRuns.some((run) => ["failed", "missed"].includes(run.status) && !run.seenAt),
      onSelect: () => dispatch({ type: "showRoutines" }),
    },
    {
      key: "apps",
      label: t("sidebar.nav.connectedApps"),
      icon: <Puzzle size={18} />,
      onSelect: () => dispatch({ type: "togglePlugins", open: true }),
    },
    {
      key: "settings",
      label: t("sidebar.menu.settings"),
      icon: <SettingsIcon size={18} />,
      separatorBefore: true,
      onSelect: () => dispatch({ type: "toggleAppSettings" }),
    },
    {
      key: "shortcuts",
      label: "Keyboard shortcuts",
      icon: <Keyboard size={18} />,
      trailing: <ShortcutHint id="shortcuts-cheat-sheet" />,
      onSelect: () => dispatch({ type: "toggleShortcuts", open: true }),
    },
    {
      key: "phone",
      label: phone.pairedCount ? t("sidebar.menu.yourPhone") : t("sidebar.menu.getIos"),
      icon: <Smartphone size={18} />,
      trailing:
        phone.kind === "connected" ? (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
        ) : undefined,
      onSelect: () => dispatch(phoneSettingsAction()),
    },
    ...(update ? [update.item] : []),
    {
      key: "help",
      label: t("sidebar.menu.help"),
      icon: <HelpCircle size={18} />,
      separatorBefore: true,
      onSelect: () => void openExternalLink(HELP_CENTER_URL),
    },
  ];

  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={name}
      placement="below"
      // A span, not a button: SidebarPopoverMenu renders its own trigger
      // button and labels it, so a button in here nests one button inside
      // another — invalid HTML, and a React console error on every launch.
      renderTrigger={({ open, attention }) => (
        <span
          style={noDragStyle}
          className={
            "relative flex size-9 items-center justify-center rounded-full transition-colors " +
            (open ? "bg-raised/60" : "hover:bg-raised/60")
          }
        >
          <InitialsAvatar initials={profileInitials(profile)} size={26} />
          {attention && !open && (
            <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-2 rounded-full bg-danger" />
          )}
        </span>
      )}
    />
  );
}