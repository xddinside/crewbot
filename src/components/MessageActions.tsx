// What one message can be done with.
//
// A "…" beside every bubble, and a frosted menu of *named* rows when it is
// opened. Before the redesign the tray slid a row of unlabelled icons out of
// the bubble: four identical 14px glyphs whose meaning lived entirely in a
// tooltip, which is no meaning at all on touch and none in a screenshot. The
// menu says what each row does.
//
// The menu is a portal, because the transcript scrolls inside
// `overflow-y-auto`: an absolutely positioned popover would be clipped by the
// pane, and a row near the top of a long thread would open into nothing. So it
// positions itself against the viewport, flips above the handle when there is
// no room below, and closes on Escape, outside pointer-down, or scroll.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/cn";
import { glassClass } from "./Glass";

/** One row of the menu. `label` is already localised — this file has no
 *  opinions about wording, only about shape. */
export interface MessageActionItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Destructive rows read red; nothing else may. */
  tone?: "default" | "danger";
  /** A hairline above this row, splitting the everyday controls from the ones
   *  that change or replace the message. */
  separator?: boolean;
  /** A whole row the caller renders itself — read aloud and raw Markdown both
   *  own state that lives outside the menu. */
  render?: ReactNode;
}

/** The class a menu row shares. Exported so a row that owns its own state —
 *  the read-aloud button, the raw-markdown toggle — is the same row as the
 *  ones this file renders, and the two cannot drift apart. */
export const messageMenuRowClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition-colors duration-[var(--motion-fast)] focus-visible:bg-raised";

export const MENU_WIDTH = 208;
const MENU_GAP = 6;

/**
 * The rows themselves, without the handle and without the portal, so a caller
 * that has somewhere else to put a menu — and a test — can render them alone.
 */
export function MessageMenu({
  label,
  items,
  onNavigate,
  onClose,
}: {
  label: string;
  items: readonly MessageActionItem[];
  onNavigate?: (delta: number) => void;
  onClose?: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      style={{ width: MENU_WIDTH }}
      className={cn(glassClass("popover"), "overflow-hidden p-1.5")}
      onKeyDown={(event: ReactKeyboardEvent) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          onNavigate?.(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose?.();
        }
      }}
    >
      {items.map((item) =>
        item.render ? (
          <Fragment key={item.id}>{item.render}</Fragment>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose?.();
              item.onSelect?.();
            }}
            className={cn(
              messageMenuRowClass,
              item.separator && "mt-1.5 border-t border-hairline/30 pt-2",
              item.tone === "danger" ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-raised/70",
              item.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Measure the handle and place the menu beside it, flipping above when the
 * viewport cannot take it below. Called on open and again on resize/scroll,
 * because the transcript scrolls under the handle the menu is anchored to.
 */
function placeMenu(anchorEl: HTMLElement | null, menu: HTMLElement | null): void {
  if (!anchorEl || !menu) return;
  const anchor = anchorEl.getBoundingClientRect();
  const height = menu.offsetHeight || 1;
  const below = window.innerHeight - anchor.bottom;
  const above = anchor.top;
  const top =
    below >= height + MENU_GAP + 8 || below >= above ? anchor.bottom + MENU_GAP : Math.max(8, anchor.top - height - MENU_GAP);
  // The handle sits on the bubble's outer side, so the menu opens inward: a
  // user bubble's handle is on its left, a bot bubble's on its right.
  const left =
    anchorEl.dataset.side === "user"
      ? Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8))
      : Math.max(8, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

/** Every enabled row, in the order the menu renders them. Read from the DOM
 *  rather than kept in a ref, so a row the caller rendered itself is a first
 *  class citizen of the arrow-key walk. */
function menuRows(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((row) => !row.hasAttribute("disabled"));
}

export function MessageActions({
  side,
  items,
  label,
  forceOpen = false,
  className,
}: {
  side: "user" | "bot";
  /** The rows. An empty list leaves the handle disabled rather than opening a
   *  menu with nothing in it. */
  items: readonly MessageActionItem[];
  /** Accessible name for the handle and for the menu itself. */
  label: string;
  /** Keeps the menu out while a control inside it must stay reachable — a
   *  message being read aloud, or one showing its raw Markdown. */
  forceOpen?: boolean;
  className?: string;
}) {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const open = (pinnedOpen || forceOpen) && items.length > 0;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu(triggerRef.current, menuRef.current);
    const remeasure = () => placeMenu(triggerRef.current, menuRef.current);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open, items.length]);

  // Move the caret onto the first row when the menu opens, and back to the
  // handle when it closes by Escape — a menu that leaves focus behind a scrim
  // is a menu nobody can Tab through.
  useEffect(() => {
    if (!open) return;
    menuRows(menuRef.current)[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPinnedOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPinnedOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // A menu that outlived the message it belongs to would float over a bubble
  // that is no longer there.
  useEffect(() => {
    if (!open) return;
    setPinnedOpen(false);
  }, [items.length]);

  const step = (delta: number) => {
    const rows = menuRows(menuRef.current);
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[at === -1 ? 0 : (at + delta + rows.length) % rows.length]?.focus();
  };

  const close = () => {
    setPinnedOpen(false);
    triggerRef.current?.focus();
  };
  const menu = (
    <div ref={menuRef} className="fixed z-50">
      <MessageMenu label={label} items={items} onNavigate={step} onClose={close} />
    </div>
  );

  return (
    <div
      className={cn("group/actions relative flex shrink-0 items-center self-end pb-0.5", className)}
      data-testid="message-actions"
      data-open={open ? "true" : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        data-side={side}
        disabled={!items.length}
        onClick={() => setPinnedOpen((v) => !v)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "rounded-md p-1.5 text-ink-secondary transition-opacity hover:bg-raised/60 hover:text-ink focus-visible:opacity-100 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          open ? "bg-raised/70 text-ink opacity-100" : "opacity-0",
          !items.length && "cursor-not-allowed hover:bg-transparent hover:text-ink-secondary",
        )}
      >
        <Ellipsis size={15} aria-hidden="true" />
      </button>
      {open && (typeof document === "undefined" ? menu : createPortal(menu, document.body))}
    </div>
  );
}