import { useMemo, useState, type DragEvent } from "react";
import { GripVertical, Search } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { MiniMonth } from "./MiniMonth";

export const BOT_CALENDAR_DRAG_TYPE = "application/x-openmaus-bot";

export interface CalendarSidebarProps {
  bots: Bot[];
  anchor: number;
  onSelectDate: (at: number) => void;
}

/** The schedule's left column: a month to pick a day in, and the bots you can
 *  drop onto the week.
 *
 *  Both halves sit **directly on the canvas**. The old version was a 320px
 *  `bg-panel` column with a right border, which meant the largest block of the
 *  screen after the conversation was an opaque plate — the opposite of the
 *  redesign. What stays opaque here is nothing: the month is text and hairlines,
 *  and the bot rows are text plus a mascot. The search field is the one control
 *  that needs an edge, and it gets a hairline rather than a fill.
 */
export function CalendarSidebar({ bots, anchor, onSelectDate }: CalendarSidebarProps) {
  const [query, setQuery] = useState("");
  const filteredBots = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return bots;
    return bots.filter((bot) =>
      `${bot.name} ${bot.title} ${bot.description}`.toLocaleLowerCase().includes(normalized),
    );
  }, [bots, query]);

  const beginBotDrag = (event: DragEvent<HTMLDivElement>, bot: Bot) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(BOT_CALENDAR_DRAG_TYPE, bot.id);
    event.dataTransfer.setData("text/plain", bot.id);
  };

  return (
    <aside aria-label="Schedule sidebar" className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden">
      <MiniMonth anchor={anchor} onSelect={onSelectDate} />

      <div className="mx-3 border-t border-hairline/25" />

      <section aria-labelledby="calendar-bots-heading" className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2
            id="calendar-bots-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-secondary"
          >
            {t("automations.botsHeading")}
          </h2>
          <span className="text-[11px] tabular-nums text-ink-secondary/70">{bots.length}</span>
        </div>

        <label className="relative mb-2 block">
          <span className="sr-only">{t("automations.searchBots")}</span>
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary/70"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder={t("automations.searchBots")}
            className="h-8 w-full rounded-lg border border-hairline/40 bg-transparent pl-8 pr-2.5 text-[11.5px] text-ink outline-none placeholder:text-ink-secondary/55 focus:border-accent/60 focus:bg-raised/40"
          />
        </label>

        <div role="list" aria-label="Bots available to schedule" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          {filteredBots.map((bot) => (
            <div
              key={bot.id}
              draggable
              onDragStart={(event) => beginBotDrag(event, bot)}
              role="listitem"
              className="group flex cursor-grab items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-raised/50 active:cursor-grabbing"
              aria-label={t("automations.dragBot", { name: bot.name })}
              title={t("automations.dragBot", { name: bot.name })}
            >
              <BotAvatar bot={bot} size={27} animated={false} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{bot.name}</div>
                {bot.title && <div className="truncate text-[10px] text-ink-secondary/75">{bot.title}</div>}
              </div>
              <GripVertical
                size={13}
                className="shrink-0 text-ink-secondary/35 transition-colors group-hover:text-ink-secondary"
                aria-hidden="true"
              />
            </div>
          ))}

          {filteredBots.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] leading-relaxed text-ink-secondary">
              {bots.length === 0 ? t("automations.noBots") : t("automations.noBotsMatch")}
            </div>
          )}
        </div>

        <p className="mt-2 px-2 text-[9.5px] leading-relaxed text-ink-secondary/65">
          {t("automations.dragHint")}
        </p>
      </section>
    </aside>
  );
}