// Frosted glass — the only opaque-ish surface in the redesign.
//
// Four shapes, one recipe. Everything else in the app sits directly on the
// ASCII sky: navigation, headings, lists, the roster, the project and thread
// lists, the goal column. Glass is reserved for the places where work happens
// and where a control needs to read as *above* the page rather than *inside*
// it — the conversation, the composer, compact content cards, popovers and
// temporary sheets.
//
// The recipe lives in CSS (`--glass-*` in styles.css) rather than here, so a
// skin can re-tune all four shapes at once and the contrast checker can still
// measure them. These components are thin on purpose: a class name, an
// element, the props.

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

/** The shape of each glass surface. `blur` is the backdrop radius, `radius`
 *  the corner, `shadow` which of the two elevation levels it sits at. */
export type GlassShape = "panel" | "card" | "popover" | "sheet";

const SHAPE_CLASS: Record<GlassShape, string> = {
  panel: "glass-panel",
  card: "glass-card",
  popover: "glass-popover",
  sheet: "glass-sheet",
};

/** The class list for one shape, exported so a menu or a portal that cannot
 *  use the component (a `position: fixed` overlay, a native dialog) can still
 *  look like the rest of the app. */
export function glassClass(shape: GlassShape, extra?: string): string {
  return cn(SHAPE_CLASS[shape], extra);
}

/** The segmented pill: the top bar's destination nav and the Inspector's lens
 *  switch are the same control at two sizes, so the rail, the active pill and
 *  the idle pill live here rather than being written twice and drifting. */
export const SEGMENT_RAIL = "flex items-center gap-0.5 rounded-full p-1";
export const SEGMENT_ACTIVE = "rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)]";
export const SEGMENT_IDLE =
  "rounded-full px-4 py-1.5 text-[13px] font-medium text-ink-secondary hover:bg-raised/60 hover:text-ink";

interface GlassBaseProps extends HTMLAttributes<HTMLElement> {
  shape?: GlassShape;
  /** Renders a plain `<div>`. The polymorphic element keeps a `<button>` or a
   *  `<form>` accessible without adding a second API. */
  as?: "div" | "section" | "article" | "aside" | "form";
  /** A sheet or a card that owns focus — a dialog, a combobox — needs its
   *  element, and the primitive is what renders it. */
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}

function glassProps<T extends HTMLElement>({ shape = "panel", className, ...rest }: GlassBaseProps): HTMLAttributes<T> {
  return { ...(rest as HTMLAttributes<T>), className: glassClass(shape, className) };
}

/**
 * The conversation surface. Wide, generous, the one place that holds a long
 * scroll — so it is the only shape with a visible edge on every side.
 */
export function GlassPanel({ shape = "panel", className, as: Element = "div", ...rest }: GlassBaseProps) {
  return <Element {...(glassProps<HTMLDivElement>({ shape, className, ...rest }) as HTMLAttributes<HTMLElement>)} />;
}

/**
 * A compact content card: needs-you, in-motion, a decision row, a project
 * card. Smaller radius and a lighter blur than the panel — a card sits *on*
 * something, it does not hold a conversation.
 */
export function GlassCard({ className, as: Element = "div", ...rest }: GlassBaseProps) {
  return <Element {...(glassProps<HTMLDivElement>({ shape: "card", className, ...rest }) as HTMLAttributes<HTMLElement>)} />;
}

/**
 * A floating surface anchored to something: a menu, a picker, the thread
 * sheet. Lifted shadow, strongest blur — it has to separate from whatever it
 * is covering.
 */
export function GlassPopover({ className, as: Element = "div", ...rest }: GlassBaseProps) {
  return <Element {...(glassProps<HTMLDivElement>({ shape: "popover", className, ...rest }) as HTMLAttributes<HTMLElement>)} />;
}

/**
 * A temporary review surface: Inspector, add-a-specialist, tool approval
 * detail. The largest of the four, because it holds a form and it is expected
 * to be dismissed.
 */
export function GlassSheet({ className, as: Element = "div", ...rest }: GlassBaseProps) {
  return <Element {...(glassProps<HTMLDivElement>({ shape: "sheet", className, ...rest }) as HTMLAttributes<HTMLElement>)} />;
}