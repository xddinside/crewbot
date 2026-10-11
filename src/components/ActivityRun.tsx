// A folded stretch of tool chips: one card of rows saying what ran, click to
// open it.
//
// Collapsed by default. A search hit inside a run opens it, and a run stays
// open once the user has opened it. Failed steps never enter a folded run,
// and neither does a step still running — so live progress is never hidden
// behind a fold and is never dressed up as a settled one.
import { useEffect, useState } from "react";
import { ChevronRight, Check, CircleAlert } from "lucide-react";
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** Who did it, when the transcript says. A room names the member on every
 *  step; a direct chat has only the one assistant, so the row drops the
 *  prefix rather than repeating its name down the card. */
function stepOwner(message: Message): string | null {
  return message.from?.name?.trim() || null;
}

export function ActivityRun({
  messages,
  forceOpen = false,
  children,
}: {
  messages: Message[];
  /** landing on a step inside this run — a search hit cannot scroll to a
   *  row that a fold has kept out of the DOM */
  forceOpen?: boolean;
  /** the individual chips, rendered by whichever transcript owns them */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const summary = describeRun(messages);

  if (open) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className="flex items-center gap-2 rounded-full border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-control"
          >
            <ChevronRight size={13} className="rotate-90" />
            <span>{summary}</span>
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="glass-card w-full max-w-[min(34rem,100%)] overflow-hidden p-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={t("chat.run.showSteps")}
          title={t("chat.run.showSteps")}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/40 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Check size={13} className="shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">
            {summary}
          </span>
          <ChevronRight size={13} className="shrink-0 text-ink-secondary" />
        </button>
        <ul className="divide-y divide-hairline/25 border-t border-hairline/25">
          {messages.map((message) => {
            const owner = stepOwner(message);
            const failed = message.tool?.ok === false;
            return (
              <li
                key={message.id}
                className="flex min-w-0 items-center gap-2 px-2 py-1.5"
              >
                {failed ? (
                  <CircleAlert
                    size={13}
                    className="shrink-0 text-danger"
                    aria-hidden="true"
                  />
                ) : (
                  <Check
                    size={13}
                    className="shrink-0 text-success"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {owner && (
                    <span className="text-ink-secondary">{owner} · </span>
                  )}
                  <span className="font-mono text-[12.5px]">
                    {message.tool?.name ?? ""}
                  </span>
                </span>
                <StepStatusChip ok={message.tool?.ok} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The status chip a live step wears. Kept beside the folded card so a run
 *  that is still going and a run that has finished read the same way. */
export function StepStatusChip({ ok }: { ok?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        ok === undefined
          ? "bg-accent/12 text-accent"
          : ok
            ? "bg-success/12 text-success"
            : "bg-danger/12 text-danger",
      )}
    >
      {ok === undefined
        ? t("toolDetail.running")
        : ok
          ? t("toolDetail.completed")
          : t("toolDetail.failed")}
    </span>
  );
}
