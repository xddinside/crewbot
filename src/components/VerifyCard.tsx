import { BookmarkPlus, CheckCircle2, ChevronDown, ChevronUp, ListChecks, Loader2, X, XCircle } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { runSummary, type RunStep } from "@/lib/verify-steps";
import { GlassCard } from "./Glass";

function StatusIcon({ status }: { status: RunStep["status"] }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "running":
      return <Loader2 aria-hidden="true" className={cn(className, "animate-spin text-accent")} />;
    case "passed":
      return <CheckCircle2 aria-hidden="true" className={cn(className, "text-success")} />;
    case "failed":
      return <XCircle aria-hidden="true" className={cn(className, "text-danger")} />;
  }
}

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60";

/** A bot's run in the current ask as a checklist — every command it ran,
 * the control-CLI ones tagged verified — with one action: put the run into
 * the composer as a skill request, for the person to annotate and send
 * through the ordinary skill review flow. The card renders whatever steps it
 * is given; whether a run is worth a card (`showRun`) is the caller's call.
 * Collapse is the card's own (a long run starts folded); dismissal is the
 * caller's, since it outlives the card. Glass, and it keeps the mockup's two
 * actions on one line: what was verified, and what to do with it. */
export function VerifyCard({
  steps,
  canSave,
  staged,
  onDismiss,
  onSave,
}: {
  steps: RunStep[];
  /** The run can be saved now: skill authoring is on, the engine has the
   * agents tools, something passed, nothing is still running or busy. */
  canSave: boolean;
  /** A skill from this run is already waiting for review. */
  staged: boolean;
  onDismiss: () => void;
  /** Fills the thread's composer with the run; nothing is sent. */
  onSave: () => void;
}) {
  const defaultCollapsed = steps.length > 6;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (steps.length === 0) return null;
  const toggleLabel = collapsed ? t("chat.verify.expand") : t("chat.verify.collapse");
  const summary = runSummary(steps);
  return (
    <GlassCard
      as="section"
      aria-label={t("chat.verify.aria")}
      data-verify-card=""
      className="w-[22rem] max-w-full p-0"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <ListChecks size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-medium">{t("chat.verify.title")}</span>
          <span role="status" aria-live="polite" aria-atomic="true" className="text-[12px] text-ink-secondary">
            {summary.label}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={ICON_BUTTON}
        >
          {collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <button type="button" onClick={onDismiss} aria-label={t("chat.verify.dismiss")} title={t("chat.verify.dismiss")} className={ICON_BUTTON}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {!collapsed && (
        <>
          <ol
            tabIndex={0}
            aria-label={t("chat.verify.steps")}
            className="max-h-56 overflow-y-auto border-t border-hairline/25 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-center gap-2 py-1">
                <StatusIcon status={step.status} />
                <span className="shrink-0 text-[13px] font-medium">{step.label}</span>
                {step.verified && (
                  <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-success">{t("chat.verify.verifiedTag")}</span>
                )}
                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-secondary" title={step.command}>
                  {step.command}
                </code>
              </li>
            ))}
          </ol>
          {staged ? (
            <div className="border-t border-hairline/25 px-3 py-2 text-[12px] text-ink-secondary">{t("chat.verify.staged")}</div>
          ) : canSave && (
            <div className="flex items-center justify-between gap-2 border-t border-hairline/25 px-3 py-2">
              <button
                type="button"
                onClick={onSave}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <BookmarkPlus size={13} aria-hidden="true" />
                {t("chat.verify.save")}
              </button>
              <span className="text-[12px] text-ink-secondary">{t("chat.verify.saveHint")}</span>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
