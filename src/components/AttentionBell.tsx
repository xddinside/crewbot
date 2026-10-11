// Attention, in the top bar.
//
// Every thread across every bot that needs the person right now, using the
// same rule and the same order as the sidebar tree — so the bell can never
// disagree with the list it duplicates. It is a popover rather than a pinned
// panel because attention is a moment, not a place: you glance, you jump,
// you come back.
//
// The jump itself is the store's own `switchTask`, so a thread lands on the
// exact conversation it names.

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { AttentionThreadRows, crossBotAttentionThreads } from "./SidebarBotActivity";
import { GlassPopover } from "./Glass";
import { useCaptionChrome } from "./DesktopCapabilities";

export function AttentionBell() {
  const { state, dispatch } = useStore();
  const { noDragStyle } = useCaptionChrome();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const attention = crossBotAttentionThreads(state.bots, state.pendingQueued);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        style={noDragStyle}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("attention.title")}
        title={t("attention.title")}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full transition-colors",
          open ? "bg-raised/60 text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
        )}
      >
        <Bell size={18} aria-hidden="true" />
        {attention.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-[var(--color-accent-ink)]"
          >
            {attention.length > 9 ? "9+" : attention.length}
          </span>
        )}
      </button>
      {open && (
        <GlassPopover
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-80 p-1.5"
          role="dialog"
          aria-label={t("attention.title")}
        >
          <div className="px-2.5 py-1.5 text-[11.5px] font-medium text-ink-secondary">
            {t("attention.title")}
            {attention.length > 0 && (
              <span className="ml-1.5 font-normal tabular-nums">{attention.length}</span>
            )}
          </div>
          {attention.length === 0 ? (
            <div className="px-2.5 pb-2 pt-0.5 text-[13px] text-ink-secondary">{t("attention.empty")}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <AttentionThreadRows
                entries={attention}
                onJump={(entry) => {
                  setOpen(false);
                  dispatch({ type: "switchTask", botId: entry.botId, threadId: entry.task.threadId });
                }}
              />
            </div>
          )}
        </GlassPopover>
      )}
    </div>
  );
}