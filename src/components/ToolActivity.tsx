import { Check, ChevronRight, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { placeLabelKey, type Place } from "@/lib/place";
import { nameIsCommand } from "@/lib/verify-steps";
import { PlaceIcon } from "./PlaceIcon";
import { WorkingDots } from "./WorkingIndicator";

/** A quiet disclosure, not a second inspector. Old messages and providers
 * without output keep their status and never invent a successful result.
 * `place` names where a screen or page tool ran, so a transcript shows the
 * place of every step, not just the current one. Absent for tools that touch
 * no screen. */
export function ToolActivity({ tool, place = null }: { tool: NonNullable<Message["tool"]>; place?: Place | null }) {
  const [expanded, setExpanded] = useState(false);
  const failed = tool.ok === false;
  const status = tool.ok === undefined ? t("toolDetail.running") : failed ? t("toolDetail.failed") : t("toolDetail.completed");
  const input = tool.input ?? tool.summary ?? tool.name;
  return (
    <details
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="group/tool glass-card w-fit max-w-full overflow-hidden text-[13px] open:w-[min(38rem,100%)]"
      data-testid="tool-activity"
    >
      <summary
        role="button"
        aria-expanded={expanded}
        aria-label={t("toolDetail.label", { name: tool.name, status })}
        className={cn(
          "flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden",
          failed ? "text-danger" : "text-ink-secondary",
        )}
      >
        <span className="shrink-0" aria-hidden="true">{tool.ok === undefined ? <WorkingDots size={3.5} /> : failed ? <X size={13} /> : <Check size={13} className="text-success" />}</span>
        {place && <PlaceIcon place={place} size={13} className="shrink-0 opacity-70" role="img" aria-label={t(placeLabelKey(place))} data-testid="tool-place" />}
        <span className="min-w-0 max-w-[30rem] truncate font-mono">{tool.name}</span>
        {tool.summary && tool.summary !== tool.name && !nameIsCommand(tool.name) && <span className="min-w-0 flex-1 truncate font-mono" title={tool.summary}>{tool.summary}</span>}
        <ChevronRight size={13} className="ml-auto shrink-0 transition-transform duration-[var(--motion-fast)] group-open/tool:rotate-90" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-hairline/25 p-3 text-ink-secondary">
        <div className={cn("text-[11px] font-medium", failed && "text-danger")}>{status}</div>
        {/* The copy controls mount with the open panel rather than sitting in
            the closed one: a collapsed <details> hides its body, so a button
            parked there is unreachable, and an inert button in the markup of
            a room's plain activity pill reads as a control that does nothing. */}
        <Detail label={t("toolDetail.input")} value={input} copyLabel={t("toolDetail.copyInput")} copyable={expanded} />
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
            <span>{t("toolDetail.output")}</span>
            {tool.output && expanded && <CopyAction label={t("toolDetail.copyOutput")} value={tool.output} />}
          </div>
          {tool.output ? <pre dir="ltr" className="max-h-64 overflow-auto rounded-lg bg-inset/70 p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-ink">{tool.output}</pre> : <p className="text-xs">{tool.ok === undefined ? t("toolDetail.waiting") : t("toolDetail.noOutput")}</p>}
        </div>
        <p className="text-[11px] text-ink-secondary">{t("toolDetail.previewHint")}</p>
      </div>
    </details>
  );
}

function Detail({ label, value, copyLabel, copyable }: { label: string; value: string; copyLabel: string; copyable: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
        <span>{label}</span>
        {copyable && <CopyAction label={copyLabel} value={value} />}
      </div>
      <pre dir="ltr" className="max-h-52 overflow-auto rounded-lg bg-inset/70 p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-ink">{value}</pre>
    </div>
  );
}

/** Copy is here because the expanded row is where someone actually wants the
 *  command, and because the transcript is the one place a command can be read
 *  without leaving the conversation. The button confirms and reverts on its
 *  own; it never leaves a "Copied" label stuck on the row. */
function CopyAction({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      aria-label={copied ? t("toolDetail.copied") : label}
      title={copied ? t("toolDetail.copied") : label}
      onClick={() => {
        if (!navigator.clipboard?.writeText) return;
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {copied ? <Check size={12} className="text-success" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}
