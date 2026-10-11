import { useState } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Copy, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { runLogText, type TimelineEvent } from "@/lib/taskTimeline";
import { formatTime } from "@/state/store";

const STATUS = {
  running: "inspector.run.running",
  complete: "inspector.run.complete",
  failed: "inspector.run.failed",
  observed: "inspector.run.observed",
} as const;

/** The readable lens. Every entry is a frosted card: the row is what ran and
 *  whether it worked, the disclosure opens the command itself. A run log that
 *  printed every command by default turned the conversation's history into a
 *  terminal — this one is bounded by the reader, not by the log. */
export function RunLog({ events }: { events: TimelineEvent[] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // The full conversation remains in chat. Keep the debugging view bounded.
  const recent = events.slice(-200);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(runLogText(recent));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-3 px-3 pt-3">
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-secondary">{t("inspector.run.hint")}</p>
        {recent.length > 0 && <button
          type="button"
          onClick={() => void copy()}
          aria-label={t("inspector.run.copy")}
          title={t("inspector.run.copy")}
          className="rounded-md p-1.5 text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
        </button>}
      </div>
      {copyState !== "idle" && <p role="status" className="px-3 pb-2 pt-1 text-[12px] text-ink-secondary">
        {t(copyState === "copied" ? "inspector.run.copied" : "inspector.run.copyFailed")}
      </p>}
      {events.length > recent.length && <p className="px-3 pb-2 text-[12px] text-ink-secondary">{t("inspector.run.recent", { count: recent.length })}</p>}
      {recent.length === 0 ? <p className="px-3 py-6 text-[13px] text-ink-secondary">{t("inspector.run.empty")}</p> : (
        <ol aria-label={t("inspector.run.title")} className="space-y-2 px-3 pb-3 pt-1">
          {recent.map((event) => (
            <RunEntry key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunEntry({ event }: { event: TimelineEvent }) {
  // Open by default: this lens exists to read commands, and a run log that
  // hides every command behind a click is a list of titles. Each card still
  // folds, so a long history can be skimmed by collapsing what you know.
  const [open, setOpen] = useState(true);
  const Icon = event.state === "failed" ? XCircle : event.state === "complete" ? CheckCircle2 : event.state === "running" ? Loader2 : Circle;
  const label = event.kind === "task" ? t("inspector.run.userInput")
    : event.kind === "screen" ? t("inspector.run.screen")
      : event.kind === "result" ? t("inspector.run.response") : event.label;
  return (
    <li className="glass-card overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        <Icon size={14} aria-hidden="true" className={cn("mt-0.5 shrink-0", event.state === "failed" ? "text-danger" : event.state === "running" ? "animate-spin text-accent" : "text-ink-secondary")} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[12.5px] font-medium text-ink">{label}</span>
          {event.kind === "tool" && <span className={cn("mt-0.5 block text-[11px]", event.state === "failed" ? "text-danger" : "text-ink-secondary")}>{t(STATUS[event.state])}</span>}
        </span>
        <time dateTime={new Date(event.at).toISOString()} className="shrink-0 tabular-nums text-[11px] text-ink-secondary">{formatTime(event.at)}</time>
        {event.command && <span className="mt-0.5 shrink-0 text-ink-secondary">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
      </button>
      {open && event.command && (
        <div className="border-t border-hairline/25 px-2.5 py-2">
          <div className="mb-1 text-[11px] font-medium text-ink-secondary">{t("inspector.run.command")}</div>
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-inset/60 p-2 font-mono text-[11.5px] leading-relaxed text-ink">{event.command}</pre>
        </div>
      )}
    </li>
  );
}
