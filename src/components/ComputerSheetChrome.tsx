// The computer sheet's chrome.
//
// Mockup 07 puts the bot's computer *beside the conversation*, not inside it:
// a glass sheet with a header that says whose computer this is and whether the
// person is driving it, a four-tab rail, a control-handoff banner, the runs-on
// strip, a desktops strip, and an inventory footer.
//
// The chrome is presentation only. Every control here calls something the app
// already had — `PlaceChip`'s place rules, the composer's pin dispatch,
// `CloudBackendPicker`, the VM workspace, the settings section, the team
// computers panel — so this file cannot drift from the logic it dresses.

import { useEffect, useRef, useState } from "react";
import {
  Box, CalendarClock, Check, ChevronDown, Columns2, Globe, Hand, Loader2,
  Maximize2, Monitor, MoreHorizontal, RefreshCw, Smartphone, Sparkles,
  UserRound, X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effectivePlace, placeLabelKey, PLACES, type Place } from "@/lib/place";
import {
  computerSheetDesktops, computerSheetTabs, desktopControllerNote,
  handoffStatusKey, type HandoffState, type SheetDesktop, type SheetTab,
} from "@/lib/computer-sheet";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { GlassPopover } from "./Glass";
import { PlaceIcon } from "./PlaceIcon";
import { usePlaceAvailability } from "./PlaceChip";
import { BrowserProfilesManager } from "./BrowserProfilesManager";

/* ── header ────────────────────────────────────────────────────────────── */

/** Whose computer this is, and whether the wheel is currently with the
 * person. The status line and the banner below read the same state, so they
 * can never disagree. */
export function ComputerSheetHeader({ bot, state, busy, onOpenSettings, onClose }: {
  bot: Bot;
  state: HandoffState;
  busy: boolean;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  return (
    <header className="flex items-start gap-3 px-4 pb-2 pt-4" data-computer-sheet-header="">
      <BotAvatar bot={bot} state={state === "under-control" ? "happy" : busy ? "working" : "idle"} size={34} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold leading-5 text-ink">{t("computerSheet.title", { name: bot.name })}</h2>
        <p className={cn(
          "mt-0.5 flex items-center gap-1.5 truncate text-[12px] leading-4",
          state === "under-control" ? "text-success" : "text-ink-secondary",
        )}>
          {busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" aria-label={t("place.live")} />}
          {t(handoffStatusKey(state), { name: bot.name })}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-1" ref={menuRef}>
        <button
          type="button"
          aria-label={t("computerSheet.menu")}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <GlassPopover role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpenSettings(); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-ink hover:bg-control"
            >
              <Monitor size={13} /> {t("computer.botSettings")}
            </button>
          </GlassPopover>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink"
        >
          <X size={14} /> {t("computerSheet.close")}
        </button>
      </div>
    </header>
  );
}

/* ── tabs ───────────────────────────────────────────────────────────────── */

const TAB_ICONS = {
  computer: Monitor,
  browser: Globe,
  routines: CalendarClock,
  android: Smartphone,
} as const;

/** The rail. Android keeps its place with a *Deferred* tag: parked is not the
 * same as removed, and it must never read as a passing feature. */
export function ComputerSheetTabs({ view, onSelect, browserEnabled, androidCapable, livePlace, live }: {
  view: SheetTab;
  onSelect: (tab: SheetTab) => void;
  browserEnabled: boolean;
  androidCapable: boolean;
  livePlace: string;
  live: boolean;
}) {
  const tabs = computerSheetTabs({ browserEnabled, androidCapable });
  return (
    <div role="tablist" aria-label={t("computerSheet.tabsAria")} data-tour="computer-tabs"
      className="mx-4 flex shrink-0 flex-wrap items-center gap-1 rounded-full bg-inset/60 p-1">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        const selected = view === tab.id;
        const tabLive = live && (tab.id === "browser" ? livePlace === "browser" : tab.id === "computer" && livePlace !== "browser" && livePlace !== "auto" && livePlace !== "off");
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-tour={tab.id === "browser" ? "computer-browser" : undefined}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              selected ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
            )}
          >
            <Icon size={13} />
            {t(tab.labelKey)}
            {tabLive && <span className="size-1.5 animate-pulse rounded-full bg-success" data-testid={`computer-tab-live-${tab.id}`} />}
            {tab.deferred && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                selected ? "bg-white/20 text-[var(--color-accent-ink)]" : "bg-raised text-ink-secondary",
              )}>{t("computerSheet.deferred")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── control handoff ────────────────────────────────────────────────────── */

/** The one banner that says who is driving. Green while the person holds the
 * wheel and the bot's input is paused; amber while the bot is asking. */
export function ControlHandoffBanner({ bot, state, helpReason, pending, onTake, onHandBack, onDismiss, showOpenHint }: {
  bot: Bot;
  state: HandoffState;
  helpReason: string | null;
  pending: boolean;
  onTake: () => void;
  onHandBack: () => void;
  onDismiss: () => void;
  showOpenHint: boolean;
}) {
  if (state === "under-control") {
    return (
      <div role="status" data-computer-banner="under-control"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2">
        <p className="min-w-0 flex-1 text-[12px] leading-4 text-ink">
          <Check size={13} className="mr-1.5 inline text-success" aria-hidden="true" />
          {t("computerSheet.youHaveControl", { name: bot.name })}
          {showOpenHint && <span className="text-ink-secondary"> {t("computer.useOpenDesktop")}</span>}
        </p>
        <button type="button" onClick={onHandBack} disabled={pending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-success px-2.5 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50">
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />}
          {t("computerSheet.handBack", { name: bot.name })}
        </button>
      </div>
    );
  }
  if (state === "asked-help") {
    return (
      <div role="status" data-computer-banner="asked-help"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2">
        <p className="min-w-0 flex-1 text-[12px] leading-4 text-ink">
          <Hand size={13} className="mr-1.5 inline text-warning" aria-hidden="true" />
          <b>{bot.name}</b> {t("computer.askedHands")} {helpReason}
        </p>
        <button type="button" onClick={onTake} disabled={pending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-accent-ink)] hover:brightness-110 disabled:opacity-50">
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />}
          {t("computer.takeControl")}
        </button>
        <button type="button" onClick={onDismiss} disabled={pending}
          className="shrink-0 rounded-lg bg-control px-2.5 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50">
          {t("computer.dismiss")}
        </button>
      </div>
    );
  }
  return null;
}

/* ── runs-on strip ──────────────────────────────────────────────────────── */

/** The execution place, named and switchable, with the reasons the composer
 * chip gives. The same availability rules, so the sheet never offers a place
 * the composer would grey out. */
function ExecutionPlace({ bot, onPin }: { bot: Bot; onPin: (place: Place | null) => void }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const availability = usePlaceAvailability(bot);
  const effective = effectivePlace(bot);
  const pinned = effective !== (bot.computer ?? "auto");
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="relative" ref={wrapperRef}>
      <button type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={t("computerSheet.runsOnAria", { place: t(placeLabelKey(effective)) })}
        data-testid="execution-place"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-control">
        <PlaceIcon place={effective} size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{t(placeLabelKey(effective))}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
      </button>
      {open && (
        <GlassPopover role="menu" aria-label={t("computerSheet.runsOnMenu")}
          className="absolute bottom-full left-0 z-40 mb-1.5 w-64 p-1.5">
          <button type="button" role="menuitemradio" aria-checked={!pinned} disabled={effective === "off"}
            onClick={() => { setOpen(false); onPin(null); }}
            className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-control", !pinned && "bg-control/50")}>
            <Sparkles size={13} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink">{t("place.followBot")}</span>
              <span className="block text-[11px] text-ink-secondary">{t("place.fromBot")}</span>
            </span>
            {!pinned && <Check size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
          </button>
          {PLACES.map((place) => {
            const reachable = availability[place];
            const selected = effective === place;
            return (
              <button key={place} type="button" role="menuitemradio" aria-checked={selected} disabled={!reachable}
                title={reachable ? undefined : t("place.unavailable")}
                onClick={() => { setOpen(false); onPin(place); }}
                className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left",
                  reachable ? "hover:bg-control" : "cursor-not-allowed opacity-45", selected && "bg-control/50")}>
                <PlaceIcon place={place} size={13} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-ink">{t(placeLabelKey(place))}</span>
                  <span className="block text-[11px] text-ink-secondary">
                    {reachable ? t(`computer.dest.${place}Desc` as "computer.dest.cloudDesc") : t("place.unavailable")}
                  </span>
                </span>
                {selected && <Check size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
              </button>
            );
          })}
        </GlassPopover>
      )}
    </div>
  );
}

/**
 * Where this conversation works, and the three doors out of it: the live
 * desktop, the two-desktop workspace, and the places computers are managed.
 */
export function RunsOnStrip({ bot, cloudSummary, onPin, onOpenDesktop, onOpenTwoDesktops, onOpenComputers, openDesktopPending, twoDesktopsAvailable }: {
  bot: Bot;
  cloudSummary: string;
  onPin: (place: Place | null) => void;
  onOpenDesktop: () => void;
  onOpenTwoDesktops?: () => void;
  onOpenComputers: () => void;
  openDesktopPending: boolean;
  twoDesktopsAvailable: boolean;
}) {
  const entry = "flex flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left text-ink hover:bg-control disabled:opacity-40";
  const caption = "text-[10px] uppercase tracking-[0.04em] text-ink-secondary";
  const value = "text-[12px] leading-4";
  return (
    <div className="flex flex-wrap items-stretch gap-x-1 gap-y-2 border-y border-hairline/40 px-3 py-2" data-computer-runs-on="">
      <div className="min-w-0 flex-1">
        <span className={caption}>{t("computerSheet.runsOn")}</span>
        <ExecutionPlace bot={bot} onPin={onPin} />
      </div>
      <div className="min-w-0">
        <span className={cn(caption, "pl-2")}>{t("computerSheet.cloudBackend")}</span>
        <span className="block truncate px-2 text-[12px] text-ink">{cloudSummary}</span>
      </div>
      <div className="flex items-end gap-1">
        <button type="button" className={entry} onClick={onOpenDesktop} disabled={openDesktopPending}>
          <span className={caption}>{t("computerSheet.openDesktop")}</span>
          <span className={cn(value, "flex items-center gap-1.5")}>
            {openDesktopPending ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}
            {t("computerSheet.openDesktop")}
          </span>
        </button>
        <button type="button" className={entry} onClick={onOpenTwoDesktops} disabled={!twoDesktopsAvailable}
          title={twoDesktopsAvailable ? t("computer.twoDesktopsTitle") : t("computerSheet.twoDesktopsUnavailable")}>
          <span className={caption}>{t("computerSheet.twoDesktops")}</span>
          <span className={cn(value, "flex items-center gap-1.5")}><Columns2 size={13} />{t("computer.twoDesktops")}</span>
        </button>
        <button type="button" className={entry} onClick={onOpenComputers}>
          <span className={caption}>{t("computerSheet.manageComputers")}</span>
          <span className={cn(value, "flex items-center gap-1.5")}><Box size={13} />{t("computerSheet.manageComputers")}</span>
        </button>
      </div>
    </div>
  );
}

/* ── desktops strip ─────────────────────────────────────────────────────── */

/** Every local VM this workspace has, with the one this conversation drives
 * marked *Controlling*. Read-only: a tile names a desktop, it does not start
 * or stop one. */
export function DesktopsStrip({ instances, controllingBotId }: {
  instances: Parameters<typeof computerSheetDesktops>[0];
  controllingBotId: string | null;
}) {
  const desktops = computerSheetDesktops(instances, controllingBotId);
  if (!desktops.length) return null;
  const note = desktopControllerNote(desktops);
  return (
    <section className="px-3 py-2" aria-label={t("computerSheet.desktops")} data-computer-desktops="">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-ink">{t("computerSheet.desktops")}</h3>
        {note && <span className="text-[11px] text-ink-secondary">{t(note)}</span>}
      </div>
      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
        {desktops.map((desktop) => <DesktopTile key={desktop.id} desktop={desktop} />)}
      </div>
    </section>
  );
}

function DesktopTile({ desktop }: { desktop: SheetDesktop }) {
  return (
    <figure className={cn(
      "w-32 shrink-0 overflow-hidden rounded-lg border bg-inset/50",
      desktop.controlling ? "border-success/60 ring-1 ring-success/40" : "border-hairline/40",
    )}>
      <div className="flex aspect-video items-center justify-center text-ink-secondary" aria-hidden="true">
        <Monitor size={18} className={desktop.openable ? "" : "opacity-40"} />
      </div>
      <figcaption className="flex items-center justify-between gap-1 border-t border-hairline/30 px-2 py-1.5">
        <span className="min-w-0 truncate text-[11px] text-ink">{desktop.name}</span>
        <span className={cn("shrink-0 text-[10px]",
          desktop.controlling ? "text-success" : "text-ink-secondary")}>
          {desktop.controlling ? t("computerSheet.controlling") : t("computerSheet.watchOnly")}
        </span>
      </figcaption>
    </figure>
  );
}

/* ── browser profiles popover ───────────────────────────────────────────── */

/** The profile the bot is signed into, as a popover over the sheet rather
 * than a modal. The editor inside is the shared one — the same component the
 * Settings section and the browser's own sheet use. */
export function BrowserProfilesPopover({ bot, disabled, onProfileChanged, open, onOpenChange }: {
  bot: Bot;
  disabled?: boolean;
  onProfileChanged?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) onOpenChange(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { onOpenChange(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);
  return (
    <div className="relative" ref={wrapperRef} data-browser-profiles="">
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-label={t("computerSheet.browserProfiles")}
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
        <UserRound size={13} /> {t("computerSheet.browserProfiles")}
      </button>
      {open && (
        <GlassPopover role="dialog" aria-label={t("settings.profiles.browserSession")}
          className="absolute right-0 top-full z-40 mt-1.5 max-h-[60vh] w-[min(340px,calc(100vw-48px))] overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-ink">{t("settings.profiles.browserSession")}</h2>
            <button type="button" aria-label={t("computerSheet.close")} onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"><X size={14} /></button>
          </div>
          <BrowserProfilesManager bot={bot} disabled={disabled} onProfileChanged={() => { onOpenChange(false); onProfileChanged?.(); }} />
        </GlassPopover>
      )}
    </div>
  );
}

/* ── inventory footer ───────────────────────────────────────────────────── */

/**
 * What this workspace owns, in one line, with a refresh and the doors to the
 * places that act on it. Purely informational: nothing here starts, stops or
 * removes anything.
 */
export function InventoryFooter({ counts, loading, problem, onRefresh, onIsolationPolicy, onPrepareImage, onSharedFolders }: {
  counts: { localVmUsed: number; localVmMax: number; boxes: number; vps: number; orphaned: number };
  loading: boolean;
  problem: string | null;
  onRefresh: () => void;
  onIsolationPolicy: () => void;
  onPrepareImage: () => void;
  onSharedFolders: () => void;
}) {
  const link = "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-accent hover:bg-control";
  return (
    <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline/40 px-3 py-2 text-[11px] text-ink-secondary" data-computer-inventory="">
      <span className="font-medium text-ink-secondary">{t("computerSheet.inventory")}</span>
      {problem
        ? <span className="text-ink-secondary" title={problem}>{t("computerSheet.inventoryUnavailable")}</span>
        : <>
          <span>{t("computerSheet.localVmCount", { used: counts.localVmUsed, max: counts.localVmMax })}</span>
          <span>{t("computerSheet.boxCount", { count: counts.boxes })}</span>
          <span>{t("computerSheet.vpsCount", { count: counts.vps })}</span>
          {counts.orphaned > 0 && <span className="text-warning">{t("computerSheet.orphanedCount", { count: counts.orphaned })}</span>}
        </>}
      <button type="button" onClick={onRefresh} disabled={loading}
        aria-label={t("computerSheet.refreshInventory")} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-control hover:text-ink disabled:opacity-40">
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> {t("common.refresh")}
      </button>
      <span className="ml-auto flex items-center gap-1">
        <button type="button" onClick={onIsolationPolicy} className={link}>{t("computerSheet.isolationPolicy")}</button>
        <button type="button" onClick={onPrepareImage} className={link}>{t("computerSheet.prepareImage")}</button>
        <button type="button" onClick={onSharedFolders} className={link}>{t("computerSheet.sharedFolders")}</button>
      </span>
    </footer>
  );
}