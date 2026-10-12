// The named step rail the welcome flow wears above its card.
//
// The dots that were here answered "how far along am I". The mockup's rail
// answers a different question — "which steps are done, and what is left" — so
// each step carries its own name. A five-step rail of words is a wider promise
// than a row of dots, so the flow keeps the dots for anything with more than
// four steps, and this for the common case.

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type StepState = "done" | "current" | "todo";

/** Pure, so the rail's states are pinned without a renderer. */
export function stepStates(count: number, index: number): StepState[] {
  return Array.from({ length: Math.max(0, count) }, (_, position) =>
    position < index ? "done" : position === index ? "current" : "todo",
  );
}

export function Stepper({
  steps,
  index,
  label,
  className,
}: {
  /** The step names in order, already translated. */
  steps: string[];
  index: number;
  label: string;
  className?: string;
}) {
  const states = stepStates(steps.length, index);
  return (
    <ol
      aria-label={label}
      className={cn("flex min-w-0 items-center gap-1 overflow-x-auto", className)}
    >
      {steps.map((name, position) => {
        const state = states[position];
        return (
          <li key={name} className="flex min-w-0 shrink-0 items-center gap-1">
            {position > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-4 shrink-0 sm:w-6",
                  state === "todo" ? "bg-hairline" : "bg-accent/50",
                )}
              />
            )}
            <span
              // The whole rail is one label for the group; each step announces
              // its own state so a screen reader reads "done" or "current"
              // rather than only the position number.
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[12px] transition-colors motion-reduce:transition-none",
                state === "current"
                  ? "bg-accent px-3 font-medium text-[var(--color-accent-ink)]"
                  : state === "done"
                    ? "text-ink"
                    : "text-ink-secondary",
              )}
            >
              {state === "done" && (
                <span className="flex size-4 items-center justify-center rounded-full bg-accent/15 text-accent-text">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
              {state === "current" && (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--color-accent-ink)]" />
              )}
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}