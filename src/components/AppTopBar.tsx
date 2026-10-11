// The top bar.
//
// One row, four things, and the only piece of chrome that is always on screen:
//
//   crewbot   [ Home | Crew | Projects ]   search · attention · you
//
// It sits directly on the sky — no plate, no border, no shadow. The pill in
// the middle is the one glass element here, because it has to read as a
// control rather than as a heading.
//
// The three destinations are *derived* from what is already selected (see
// lib/shell-nav.ts), not stored, so a lit pill can never disagree with the
// screen below it.

import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";
import { SEGMENT_ACTIVE, SEGMENT_IDLE } from "./Glass";
import { DESTINATIONS, DESTINATION_LABEL, type Destination } from "@/lib/shell-nav";
import { AttentionBell } from "./AttentionBell";
import { AvatarMenu } from "./AvatarMenu";

export interface AppTopBarProps {
  destination: Destination;
  onSelect: (destination: Destination) => void;
  onOpenSearch: () => void;
}

/** The pill segmented control.
 *
 *  A `radiogroup`, because exactly one destination is current: the arrow keys
 *  move between them the way a radio list does, and only the active pill is in
 *  the tab order, so Tab leaves the group rather than walking three stops.
 *
 *  The bar itself is the window drag region on a frameless build, but the pill
 *  opts back out — otherwise a drag started on a button moves the window. */
function DestinationNav({ destination, onSelect }: Omit<AppTopBarProps, "onOpenSearch">) {
  const { noDragStyle } = useCaptionChrome();
  const move = (delta: number) => {
    const index = DESTINATIONS.indexOf(destination);
    onSelect(DESTINATIONS[(index + delta + DESTINATIONS.length) % DESTINATIONS.length]);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("sidebar.tools") === "Tools" ? "Primary" : "Primary"}
      className="glass-panel pointer-events-auto flex items-center gap-0.5 rounded-full p-1"
    >
      {DESTINATIONS.map((item) => {
        const active = item === destination;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            style={noDragStyle}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                move(1);
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                move(-1);
              }
            }}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px] font-medium",
              "transition-[background-color,color] duration-[var(--motion-base)] ease-[var(--motion-curve)]",
              active ? SEGMENT_ACTIVE : SEGMENT_IDLE,
            )}
          >
            {DESTINATION_LABEL[item]}
          </button>
        );
      })}
    </div>
  );
}

export function AppTopBar({ destination, onSelect, onOpenSearch }: AppTopBarProps) {
  const { dragStyle, noDragStyle, padClass } = useCaptionChrome();
  const { capabilities } = useDesktopCapabilities();
  const macInset = capabilities.windowChrome === "mac-inset";

  return (
    <header
      // The whole bar is a window drag region on the frameless builds; every
      // control inside opts back out, so a drag that starts on a button never
      // moves the window.
      style={dragStyle}
      data-top-bar=""
      className={cn(
        "relative z-30 flex shrink-0 items-center gap-3 py-2.5 pr-4",
        // macOS owns the inset traffic lights: reserve their corner so the
        // wordmark never sits under them.
        macInset ? "pl-[86px]" : "pl-4",
        // The renderer-drawn Windows caption buttons own the top-right corner,
        // so the right-hand controls shift below them (see useCaptionChrome).
        padClass,
      )}
    >
      <span className="w-40 shrink-0 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        crewbot
      </span>

      <div className="pointer-events-none flex flex-1 justify-center">
        <DestinationNav destination={destination} onSelect={onSelect} />
      </div>

      <div style={noDragStyle} className="flex w-40 shrink-0 items-center justify-end gap-1">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={t("sidebar.searchAria")}
          title={`${t("sidebar.search")} (Ctrl+K)`}
          className="flex size-9 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink"
        >
          <Search size={18} aria-hidden="true" />
        </button>
        <AttentionBell />
        <AvatarMenu />
      </div>
    </header>
  );
}