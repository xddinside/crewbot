// The chrome every decision card in the transcript shares.
//
// Four surfaces ask a person to decide something — a permission, a question, a
// first-run quiz, a credential — and they were four independent copies of the
// same bordered box, the same header, the same radio dot and the same selected
// row. This is that box, once. Everything it draws is glass (`GlassCard`), so a
// decision reads as a card floating on the sky rather than as an opaque slab
// interrupting the conversation.
//
// It carries no behaviour: the cards keep their own state, their own dispatch
// and their own wording. What it owns is the shape — a glyph, a title, an
// aside, a body, a footer — so the four cannot drift apart.

import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Check, ShieldCheck, X } from "lucide-react";

import { GlassCard } from "./Glass";
import { cn } from "@/lib/cn";
import { choiceLayout, type ChoiceOption } from "@/lib/decision-card";

export type { ChoiceOption };

/** Glyph tile. The one place a decision card spends colour on chrome. */
const TILE = "flex size-8 shrink-0 items-center justify-center rounded-xl bg-inset/60";

export function DecisionCard({
  glyph,
  title,
  aside,
  asideTitle,
  settled,
  footer,
  className,
  children,
  ...rest
}: {
  /** the card's own mark: a gear, a question, a key, a letter. */
  glyph?: ReactNode;
  /** one line, the strongest thing on the card. */
  title?: ReactNode;
  /** the quiet half of the header: a tool name, a count, a status. */
  aside?: ReactNode;
  /** tooltip for `aside` when it is a bare monospace token. */
  asideTitle?: string;
  /** answered: the card stays, its claims soften, it stops asking. */
  settled?: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <GlassCard
      data-decision-card=""
      className={cn(
        "w-full max-w-[840px] p-3.5 transition-opacity duration-[var(--motion-base)]",
        settled && "opacity-75",
        className,
      )}
      {...rest}
    >
      {(glyph || title || aside) && (
        <div className="flex items-start gap-2.5">
          {glyph && <span className={TILE}>{glyph}</span>}
          {title && (
            <div className="min-w-0 flex-1 pt-0.5 text-[14.5px] font-semibold leading-5 text-ink">
              {title}
            </div>
          )}
          {aside && (
            <div title={asideTitle} className="shrink-0 pt-1 text-[11.5px] font-medium text-ink-secondary">
              {aside}
            </div>
          )}
        </div>
      )}
      {children}
      {footer && <div className="mt-3 border-t border-hairline/25 pt-2.5">{footer}</div>}
    </GlassCard>
  );
}

/** The closing line of a decision card: what happened, or that it is waiting on
 *  the person. One component, so an answered card reads the same whichever
 *  surface answered it — allow-once and a persistent grant are both "allowed",
 *  and the narrow grant is still reported by the strip above the composer. */
export function DecisionReceipt({
  settled,
  allow,
  deny,
  waiting,
}: {
  settled: boolean;
  /** the allowed / answered reading; falsy means the denied one */
  allow: ReactNode;
  deny: ReactNode;
  waiting: ReactNode;
}) {
  return (
    <div role="status" className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
      {settled ? (
        allow ? (
          <Check size={13} aria-hidden="true" className="shrink-0 text-success" />
        ) : (
          <X size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        )
      ) : (
        <ShieldCheck size={13} aria-hidden="true" className="shrink-0 text-accent" />
      )}
      <span className="min-w-0">{settled ? (allow ? allow : deny) : waiting}</span>
    </div>
  );
}

/** The radio dot / checkbox tick, drawn rather than an `<input>` so the whole
 *  choice stays one button and the hit target is the choice, not the circle. */
export function ChoiceMarker({ checked, multi }: { checked: boolean; multi: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
        multi ? "rounded-[5px]" : "rounded-full",
        "transition-colors duration-[var(--motion-fast)]",
        checked ? "border-accent bg-accent" : "border-hairline",
      )}
    >
      {checked &&
        (multi ? (
          <Check size={11} className="text-white" strokeWidth={3} />
        ) : (
          <span className="size-1.5 rounded-full bg-white" />
        ))}
    </span>
  );
}

interface Entry {
  option: ChoiceOption;
  isOther: boolean;
}

const CHIP_SELECTED = "border-accent/55 bg-accent/10";
const CHIP_IDLE = "border-hairline/45 hover:bg-raised-hover/50";

/**
 * A question's own options, laid out by {@link choiceLayout}: a row of chips
 * for a short single-choice ask, a column of rows when a description or a
 * second tick has to fit. Either way the roles are a real radio group or
 * checkbox group, so the arrow keys and the announced state come from the
 * browser rather than from here.
 */
export function ChoiceList({
  question,
  options,
  picked,
  multiSelect,
  disabled,
  onChoose,
  onOther,
  otherOpen,
  otherLabel,
  marker,
  children,
}: {
  /** the question text, used as the group's accessible name */
  question: string;
  options: readonly ChoiceOption[];
  picked: readonly string[];
  multiSelect: boolean;
  disabled?: boolean;
  onChoose: (label: string) => void;
  /** the free-text row/chip; omitted when the question cannot take one */
  onOther?: () => void;
  otherOpen?: boolean;
  otherLabel?: string;
  /** replaces the radio dot — the onboarding quiz marks its rows A/B/C */
  marker?: (option: ChoiceOption, checked: boolean) => ReactNode;
  /** the free-text field, mounted under an open "Other" */
  children?: ReactNode;
}) {
  const chips = choiceLayout(options, multiSelect) === "chips";
  const entries: Entry[] = [
    ...options.map((option) => ({ option, isOther: false })),
    ...(onOther ? [{ option: { label: otherLabel ?? "" }, isOther: true }] : []),
  ];

  return (
    <div
      role={multiSelect ? "group" : "radiogroup"}
      aria-label={question}
      className={cn("mt-3", chips ? "flex flex-wrap gap-2" : "overflow-hidden rounded-xl border border-hairline/35")}
    >
      {entries.map(({ option, isOther }, index) => {
        const checked = isOther ? Boolean(otherOpen) : picked.includes(option.label);
        return (
          <button
            key={isOther ? "__other" : option.label}
            type="button"
            role={multiSelect ? "checkbox" : "radio"}
            aria-checked={checked}
            disabled={disabled}
            onClick={() => (isOther ? onOther?.() : onChoose(option.label))}
            className={cn(
              "text-[14px] leading-snug text-ink outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60",
              chips
                ? "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-center"
                : "flex w-full items-start gap-2.5 px-3 py-2.5 text-left",
              chips
                ? checked ? CHIP_SELECTED : CHIP_IDLE
                : checked ? "bg-raised-hover" : "hover:bg-raised-hover/55",
              !chips && index > 0 && "border-t border-hairline/30",
              disabled && "cursor-default opacity-70",
            )}
          >
            {marker
              ? marker(option, checked)
              : <ChoiceMarker checked={checked} multi={multiSelect} />}
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-[12.5px] font-normal text-ink-secondary">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** The free-text field that hangs under an open "Other". Rendered outside the
 *  list's buttons, so typing in it never toggles the choice that revealed it.
 *  `basis-full` makes it take its own line in the chip row, where a flex child
 *  would otherwise be squeezed to the width of a chip. */
export function OtherAnswer({ children }: { children: ReactNode }) {
  return <div className="w-full basis-full border-t border-hairline/30 px-3 py-2.5">{children}</div>;
}

/** A field the card owns — the credential box, a quiz's own words. */
export function DecisionInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full rounded-lg border border-hairline/45 bg-inset/60 px-3 py-2 text-[13.5px] text-ink",
        "outline-none transition-colors duration-[var(--motion-fast)] placeholder:text-ink-secondary/70",
        "focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/50",
        className,
      )}
      {...rest}
    />
  );
}
