// The search sheet.
//
// Ctrl+K and the top bar's search glyph are one action with one state (the
// shell owns the boolean), so the two can never disagree about what is open.
//
// The sheet is not a command registry the app does not have. It answers
// exactly three questions: which conversation is this, which message in it,
// and which fork of that message — a hit off the active branch is labelled
// *Other version*, because opening it moves the branch. Names come from local
// state and answer instantly; transcript hits come from /api/search a beat
// later. A stale response for an outdated query is dropped rather than shown.
import { useEffect, useRef, useState } from "react";
import { Bot as BotIcon, Folder, MessageSquare, Search, Users } from "lucide-react";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { rankByName } from "@/lib/palette-rank";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { glassClass } from "./Glass";
import type { SearchHit } from "@/lib/search-hit";
import { landOnSearchHit } from "@/lib/focus-message";

type PaletteEntry =
  | { kind: "bot"; bot: Bot }
  | { kind: "room"; group: Group }
  | { kind: "message"; hit: SearchHit };

/** The audit pins both numbers: a global search shows at most 12 transcript
 *  hits, and never more than 40 rows of anything. */
const TRANSCRIPT_LIMIT = 12;

export function CommandPalette({ onOpenChange, open: controlledOpen }: { onOpenChange?: (open: boolean) => void; open?: boolean }) {
  const { state, dispatch } = useStore();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // The top bar's search entry opens the same palette the chord does, so the
  // button is not a second, differently-behaving search. A controlled `open`
  // lets the shell drive it; with none supplied the palette keeps owning its
  // own state exactly as before.
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOpen === undefined ? setUncontrolledOpen : () => {};
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // The chord fires from anywhere — Shell's app-wide shortcuts (⌘N, ⌘1–9)
  // set the precedent of not guarding against focused inputs, and a
  // modifier chord never collides with typing. It is ignored while the shell
  // is driving the palette, or the two would fight over one boolean.
  useEffect(() => {
    if (controlledOpen !== undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setUncontrolledOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlledOpen]);

  // fresh sheet every open; stale queries from last time would flash
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMessageHits([]);
    setCursor(0);
  }, [open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const q = query.trim().toLowerCase();

  // Same debounce pattern as the sidebar search: names answer instantly
  // from local state, transcript hits arrive a beat later, and a stale
  // response for an outdated query is dropped.
  useEffect(() => {
    if (!open || !q) {
      setMessageHits([]);
      return;
    }
    // Results for the previous query must not remain clickable while the
    // debounce and request for this query are pending.
    setMessageHits([]);
    let alive = true;
    const timer = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}&limit=${TRANSCRIPT_LIMIT}`)
        .then((result: { hits?: SearchHit[] }) => alive && setMessageHits(result.hits ?? []))
        .catch(() => alive && setMessageHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, messageHits]);

  if (!open) return null;

  const bots = rankByName(state.bots.filter((b) => !b.hidden), q);
  const rooms = rankByName(state.groups, q);
  const entries: PaletteEntry[] = [
    ...bots.map((bot): PaletteEntry => ({ kind: "bot", bot })),
    ...rooms.map((group): PaletteEntry => ({ kind: "room", group })),
    // message hits only make sense for a typed query; empty = switcher mode
    ...(q ? messageHits.map((hit): PaletteEntry => ({ kind: "message", hit })) : []),
  ];
  // hits arriving or rows filtering away can strand the cursor past the end
  const selected = entries.length ? Math.min(cursor, entries.length - 1) : 0;

  const activate = async (entry: PaletteEntry) => {
    if (entry.kind === "message") {
      const hit = entry.hit;
      try {
        await landOnSearchHit(hit, state, dispatch);
      } catch (error) {
        dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } else {
      dispatch({ type: "select", id: entry.kind === "bot" ? entry.bot.id : entry.group.id });
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // shield the window listeners other modals hang their own Esc on
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(entries.length ? (selected + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(entries.length ? (selected - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[selected];
      if (entry) void activate(entry);
    }
  };

  // flat cursor across sections; each row needs its absolute index
  const roomOffset = bots.length;
  const messageOffset = bots.length + rooms.length;

  const row = (key: string, index: number, onPick: () => void, children: React.ReactNode, twoLine = false) => (
    <button
      key={key}
      ref={index === selected ? selectedRef : undefined}
      onClick={onPick}
      // mousemove, not mouseenter: rows shifting under a resting pointer
      // (hits arriving) must not steal the keyboard selection
      onMouseMove={() => setCursor(index)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-[var(--motion-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]",
        twoLine && "flex-col items-stretch gap-0.5",
        index === selected ? "bg-raised/70" : "hover:bg-raised/40",
      )}
    >
      {children}
    </button>
  );

  const heading = (label: string) => (
    <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{label}</div>
  );

  /** "Today 10:15" for a hit — the mockup puts the conversation and when it
   *  happened on one line, because a person scanning results is looking for
   *  "where was that", not "which of these four similar sentences". */
  const hitTime = (at: number) => {
    const when = new Date(at);
    const today = new Date();
    const sameDay = when.toDateString() === today.toDateString();
    return `${sameDay ? t("search.today") : ""} ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(when)}`.trim();
  };

  return (
    /* The scrim is a wash rather than a blackout: the sheet is glass, and a
       pale veil lets the conversation underneath stay recognisable instead of
       being replaced by a hole. */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center app-scrim p-6 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        className={cn(glassClass("sheet"), "flex max-h-[min(520px,72vh)] w-full max-w-[600px] flex-col overflow-hidden")}
      >
        <div className="flex items-center gap-3 border-b border-hairline/30 px-4 py-3">
          <Search size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <h2 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-ink">{t("search.title")}</h2>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[13.5px] text-ink placeholder:text-ink-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
          />
          <kbd className="shrink-0 rounded-md border border-hairline/40 px-1.5 py-0.5 text-[11px] text-ink-secondary">
            {t("search.shortcutLabel")}
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">
              {q ? t("search.nothing", { query }) : t("search.empty")}
            </div>
          )}
          {bots.length > 0 && heading(t("search.bots"))}
          {bots.map((bot, i) =>
            row(
              `bot:${bot.id}`,
              i,
              () => void activate({ kind: "bot", bot }),
              <>
                <BotIcon size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="truncate text-[14px] text-ink">{bot.name}</span>
                {bot.title && (
                  <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">{bot.title}</span>
                )}
              </>,
            ),
          )}
          {rooms.length > 0 && heading(t("search.rooms"))}
          {rooms.map((group, i) =>
            row(
              `room:${group.id}`,
              roomOffset + i,
              () => void activate({ kind: "room", group }),
              <>
                <Users size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="truncate text-[14px] text-ink">{group.name}</span>
              </>,
            ),
          )}
          {q && messageHits.length > 0 && heading(t("search.messages"))}
          {q &&
            messageHits.map((hit, i) => {
              const before = hit.snippet.slice(0, hit.matchStart);
              const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
              const after = hit.snippet.slice(hit.matchStart + hit.matchLength);
              const bot = hit.botId ? state.bots.find((b) => b.id === hit.botId) : undefined;
              const room = hit.groupId ? state.groups.find((g) => g.id === hit.groupId) : undefined;
              const owner = room?.name ?? bot?.name ?? hit.name;
              return row(
                `msg:${hit.threadId}:${hit.messageId}`,
                messageOffset + i,
                () => void activate({ kind: "message", hit }),
                <>
                  <span className="flex items-center gap-2 text-[13px]">
                    {room ? (
                      <Folder size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                    ) : (
                      <MessageSquare size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                    )}
                    <span className="truncate font-medium text-ink">{hit.task ?? owner}</span>
                    <span className="shrink-0 text-[12px] text-ink-secondary">· {owner}</span>
                    <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-ink-secondary">{hitTime(hit.at)}</span>
                  </span>
                  <span className="line-clamp-2 text-[12.5px] text-ink-secondary">
                    {before}
                    <mark className="rounded-sm bg-accent/25 px-0.5 text-ink">{match}</mark>
                    {after}
                  </span>
                  {/* F032: a hit on a fork is not this conversation's live
                      answer, and opening it moves the branch. Say so. */}
                  {!hit.onActivePath && (
                    <span className="flex items-center gap-1 text-[11px] text-ink-secondary">{t("search.otherVersion")}</span>
                  )}
                </>,
                true,
              );
            })}
        </div>
        <div className="flex items-center gap-3 border-t border-hairline/30 px-4 py-2 text-[11.5px] text-ink-secondary">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-raised/60 px-1 py-0.5 font-mono text-[10.5px]">↑</kbd>
            <kbd className="rounded bg-raised/60 px-1 py-0.5 font-mono text-[10.5px]">↓</kbd>
            {t("search.hint.navigate")}
          </span>
          <span>
            <kbd className="rounded bg-raised/60 px-1 py-0.5 font-mono text-[10.5px]">{t("search.hint.enterKey")}</kbd>{" "}
            {t("search.hint.open")}
          </span>
          <span>
            <kbd className="rounded bg-raised/60 px-1 py-0.5 font-mono text-[10.5px]">{t("search.hint.escKey")}</kbd>{" "}
            {t("search.hint.close")}
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              dispatch({ type: "toggleShortcuts", open: true });
            }}
            className="ms-auto rounded px-1 py-0.5 text-ink-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
          >
            {t("search.shortcuts")}
          </button>
        </div>
      </div>
    </div>
  );
}