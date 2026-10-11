// The composer's mode menu.
//
// The same four ways a message can go out that `/goal`, `/learn` and
// /setup` reach by typing — opened with a click instead. The gates live in
// lib/composer-commands.ts, so this menu and the typed slash picker can never
// offer different things.
//
// Glass, because it floats over the conversation. It closes on Escape and on a
// click outside, and hands the caret back to the composer.

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  MessageSquare,
  Settings2,
  Target,
  type LucideIcon,
} from "lucide-react";
import { GlassPopover } from "./Glass";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type {
  ComposerModeId,
  ComposerModeOption,
} from "@/lib/composer-commands";

const ICONS: Record<ComposerModeId, LucideIcon> = {
  chat: MessageSquare,
  goal: Target,
  learn: BookOpen,
  setup: Settings2,
};

/** The label and the line under it, per mode. `Chat` is the plain send; the
 *  other three are the ones the gates can switch off. */
const COPY: Record<
  ComposerModeId,
  { label: LocaleKey; hint: LocaleKey; unavailable: LocaleKey }
> = {
  chat: {
    label: "composer.mode.chat.label",
    hint: "composer.mode.chat.hint",
    unavailable: "composer.mode.chat.unavailable",
  },
  goal: {
    label: "composer.mode.goal.label",
    hint: "composer.mode.goal.hint",
    unavailable: "composer.mode.goal.unavailable",
  },
  learn: {
    label: "composer.mode.learn.label",
    hint: "composer.mode.learn.hint",
    unavailable: "composer.mode.learn.unavailable",
  },
  setup: {
    label: "composer.mode.setup.label",
    hint: "composer.mode.setup.hint",
    unavailable: "composer.mode.setup.unavailable",
  },
};

export function ComposerModeMenu({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: readonly ComposerModeOption[];
  value: ComposerModeId;
  onSelect: (mode: ComposerModeId) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      if (
        !(event.target instanceof Node) ||
        !wrapRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("composer.mode.aria")}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] outline-none transition-colors duration-[var(--motion-fast)] disabled:opacity-50",
          value === "chat"
            ? "border-hairline/30 bg-transparent text-ink-secondary hover:bg-raised/60 hover:text-ink"
            : "border-accent/35 bg-accent/10 text-accent",
          "focus-visible:ring-2 focus-visible:ring-accent/60",
        )}
      >
        {value === "chat" ? (
          <MessageSquare aria-hidden="true" size={14} />
        ) : (
          <Target aria-hidden="true" size={14} />
        )}
        <span className="whitespace-nowrap">{t(COPY[value].label)}</span>
        <ChevronDown
          aria-hidden="true"
          size={13}
          className={cn(
            "shrink-0 transition-transform duration-[var(--motion-base)]",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <GlassPopover
          role="listbox"
          aria-label={t("composer.mode.aria")}
          className="absolute bottom-full right-0 z-30 mb-2 w-[280px] p-1"
        >
          <ComposerModeList
            options={options}
            value={value}
            onSelect={(mode) => {
              setOpen(false);
              onSelect(mode);
            }}
          />
        </GlassPopover>
      )}
    </div>
  );
}

/** The four rows, on their own so the wording can be read without a click.
 *  An unavailable row stays in the list and says why — "why is there no Goal
 *  here" is a question people ask, and a missing row does not answer it. */
export function ComposerModeList({
  options,
  value,
  onSelect,
}: {
  options: readonly ComposerModeOption[];
  value: ComposerModeId;
  onSelect: (mode: ComposerModeId) => void;
}) {
  return (
    <>
      {options.map((option) => {
        const Icon = ICONS[option.id];
        return (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === value}
            disabled={!option.available}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60",
              option.id === value ? "bg-raised/70" : "hover:bg-raised/60",
              !option.available &&
                "cursor-not-allowed opacity-55 hover:bg-transparent",
            )}
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon aria-hidden="true" size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {t(COPY[option.id].label)}
              </span>
              <span className="block truncate text-[11.5px] text-ink-secondary">
                {t(
                  option.available
                    ? COPY[option.id].hint
                    : COPY[option.id].unavailable,
                )}
              </span>
            </span>
            {option.id === value && (
              <Check
                aria-hidden="true"
                size={15}
                className="mt-1 shrink-0 text-accent"
              />
            )}
          </button>
        );
      })}
    </>
  );
}
