// Per-bot settings as a right sidebar with fold-out (accordion) categories —
// same shell pattern as InspectorPanel. Every section lives under
// bot-settings/; this dialog owns only which accordion row is expanded, and
// the fetches it shares with the Crew profile page.
//
// The Crew profile (BotProfilePage) shows the same twelve sections as one
// section at a time on the sky. Both hosts read their bodies and their data
// from `BotSectionBody` / `useBotProfileData`, so "the panel" and "the page"
// cannot drift into showing different controls for the same bot.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "./ConfirmDialog";
import { BOT_SECTIONS, sectionMatches } from "./bot-settings/sections";
import { BotSectionBody } from "./bot-settings/BotSectionBody";
import { useBotProfileData } from "./bot-settings/useBotProfileData";

export { sectionMatches };

export function BotSettingsDialog({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const section = state.botSettingsSection;
  const data = useBotProfileData(bot, section);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  // Keep expansion in the store too: header deep links can arrive while
  // this panel is already mounted, including after collapsing the same row.
  const collapsed = !state.botSettingsExpandAccordion;
  const q = query.trim().toLowerCase();
  const visibleSections = BOT_SECTIONS.filter((entry) => sectionMatches(entry, q));

  useEffect(() => {
    // Search narrows the collapsed row list. Choosing a row (or following
    // an external deep link) clears that filter so it cannot hide the body.
    if (collapsed) return;
    if (q) { setQuery(""); return; }
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section, q]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside this one (the routine editor, a skill
      // review, the model picker's popover, a computer warning) owns Escape
      // while it is up: Escape closes only that layer.
      // Only a *visible* nested dialog owns Escape. A hidden or
      // zero-size leftover (display:none, empty hit box) must not trap
      // the settings panel's own dismiss path.
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      // BotInstructionsDialog portals to document.body, so it is not in this
      // subtree: a key pressed with focus outside this dialog belongs to
      // whatever holds focus, never to us.
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <>
      <aside
        ref={dialogRef}
        role="dialog"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        className="animate-panel-in absolute inset-0 z-40 flex h-full min-w-0 flex-col border-l border-hairline/40 bg-panel outline-none lg:static lg:z-auto lg:w-[min(420px,42vw)] lg:shrink-0"
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <span id="bot-settings-title" className="truncate text-[15px] font-semibold text-ink">
            {bot.name}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleSettings", open: false })}
            aria-label="Close settings"
            className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
          >
            <X size={18} className="pointer-events-none" />
          </button>
        </div>

        <div className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-control/70 px-2.5 py-2">
          <Search size={14} className="shrink-0 text-ink-secondary" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              dispatch({ type: "toggleSettings", open: true });
            }}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              if (query) setQuery("");
              else dispatch({ type: "toggleSettings", open: false });
            }}
            placeholder="Search"
            aria-label="Search settings"
            className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {visibleSections.length === 0 && (
            <div className="px-4 py-4 text-[12.5px] leading-relaxed text-ink-secondary">
              Nothing matches “{query.trim()}”
            </div>
          )}
          {/* Walk all sections so Memory keeps a stable mount (draft survival)
              even when search filters its row out of view. Other unmatched
              rows are omitted entirely. */}
          {BOT_SECTIONS.map((entry) => {
            const { id, label, icon: Icon } = entry;
            const matched = sectionMatches(entry, q);
            if (!matched && id !== "memory") return null;
            const open = !collapsed && section === id;
            return (
              <div
                key={id}
                data-bot-settings-section={id}
                className="border-b border-hairline/30"
                hidden={!matched}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (section === id && !collapsed) {
                      dispatch({ type: "toggleSettings", open: true });
                      return;
                    }
                    dispatch({ type: "toggleSettings", open: true, section: id });
                  }}
                  aria-expanded={open}
                  className={cn(
                    "flex w-full shrink-0 items-center gap-2.5 px-4 py-2.5 text-left text-[14px]",
                    open ? "bg-control/60 text-ink" : "text-ink-secondary hover:bg-control/40 hover:text-ink",
                  )}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <ChevronDown
                    size={16}
                    className={cn(
                      "shrink-0 text-ink-secondary transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
                {/* Memory stays mounted (hidden when collapsed) so drafts survive;
                    other sections only mount while expanded. */}
                {id === "memory" ? (
                  <div hidden={!open} className="px-4 pb-4 pt-1">
                    <BotSectionBody bot={bot} section="memory" data={data} memoryActive={open} />
                  </div>
                ) : (
                  open && (
                    <div className="px-4 pb-4 pt-1">
                      <BotSectionBody bot={bot} section={id} data={data} />
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </aside>
      <ConfirmDialog
        open={data.rollbackTarget !== null}
        title="Restore previous instructions?"
        body="Replaces current SOUL with the version before this change. Current version stays in History."
        confirmLabel="Restore instructions"
        tone="neutral"
        returnFocusRef={dialogRef}
        onCancel={data.cancelRollback}
        onConfirm={() => void data.performRollback()}
      />
    </>
  );
}