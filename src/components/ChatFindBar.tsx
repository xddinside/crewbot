import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { landOnSearchHit } from "@/lib/focus-message";
import { t } from "@/lib/i18n";
import type { SearchHit } from "@/lib/search-hit";
import { api, useStore } from "@/state/store";

export function ChatFindBar({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const request = ++requestRef.current;
    if (!trimmed) {
      setHits([]);
      setIndex(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api(`/api/search?q=${encodeURIComponent(trimmed)}&limit=100&threadId=${encodeURIComponent(threadId)}`)
        .then((body) => {
          if (request !== requestRef.current) return;
          setHits(Array.isArray(body?.hits) ? body.hits : []);
          setIndex(0);
        })
        .catch((error) => {
          if (request !== requestRef.current) return;
          setHits([]);
          dispatch({ type: "error", message: error instanceof Error ? error.message : t("chat.find.failed") });
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [dispatch, query, threadId]);

  const land = (next: number) => {
    const hit = hits[next];
    if (!hit) return;
    setIndex(next);
    void landOnSearchHit(hit, state, dispatch).catch((error) =>
      dispatch({ type: "error", message: error instanceof Error ? error.message : t("chat.find.unavailable") }),
    );
  };
  const move = (delta: number) => {
    if (!hits.length) return;
    land((index + delta + hits.length) % hits.length);
  };

  // Jump to the first match as soon as a new result set arrives.
  useEffect(() => {
    if (hits[0]) land(0);
    // `land` intentionally reads the state that produced this result set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  /* Narrow and floating, scoped to this thread. It sits on the conversation's
     own glass rather than over the canvas: the hits it walks are in the
     transcript, and a bar floating away from the transcript would be asking
     the reader to look in two places. 100 hits is the cap the audit pins. */
  return (
    <div className="w-full px-5 pb-2 pt-1">
      <div className="glass-card flex w-full max-w-[520px] items-center gap-1.5 px-2.5 py-1.5">
        <Search size={15} className="shrink-0 text-ink-secondary" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "Enter") {
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder={t("chat.find.placeholder")}
          aria-label={t("chat.find.placeholder")}
          className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-ink-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
        />
        <span className="min-w-[58px] text-right text-[11.5px] tabular-nums text-ink-secondary">
          {loading
            ? t("chat.find.searching")
            : query.trim()
              ? hits.length
                ? t("chat.find.position", { index: index + 1, count: hits.length })
                : t("chat.find.noResults")
              : ""}
        </span>
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={!hits.length}
          aria-label={t("chat.find.previous")}
          className="flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-30"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={!hits.length}
          aria-label={t("chat.find.next")}
          className="flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-30"
        >
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("chat.find.close")}
          className="flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
