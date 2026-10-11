// Home — the landing.
//
// The conversation is the screen. Everything around it is context: a greeting
// over the top, who you are talking to and what happened today down the left,
// what needs you and what is moving down the right. None of that is a
// container — the greeting, the rail and the column all sit directly on the
// sky, and the only glass on the page is the conversation the chat brings
// with it.
//
// Below `lg` none of this mounts: a phone has one column and one job, and the
// sidebar drawer already covers that case. Home is a wide-window landing.

import { useEffect, useState, type ReactNode } from "react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { greetingFirstName, greetingPart } from "@/lib/home-context";
import { HomeRail } from "./HomeRail";
import { HomeContext } from "./HomeContext";

const GREETING_KEYS = {
  morning: "home.greeting.morning",
  afternoon: "home.greeting.afternoon",
  evening: "home.greeting.evening",
} as const;

/** Re-reads on the hour rather than on a timer: the greeting only changes when
 *  the hour does, and a landing that re-renders the conversation every minute
 *  would repaint the largest thing on screen to keep one word current. */
function useGreetingPart(): (typeof GREETING_KEYS)[keyof typeof GREETING_KEYS] {
  const [part, setPart] = useState(() => greetingPart(new Date().getHours()));
  useEffect(() => {
    const timer = setInterval(() => setPart(greetingPart(new Date().getHours())), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  return GREETING_KEYS[part];
}

/**
 * "Good evening, Nirvan" over "Your personal assistant, Maus."
 *
 * Both lines are optional in the ways they need to be: no configured name and
 * the greeting is the bare salutation rather than a comma with nothing after
 * it. The subtitle names the assistant the user actually has.
 */
function HomeGreeting({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const greetingKey = useGreetingPart();
  // `t` reads a module variable, so this is what makes the line follow a
  // language switch — the same signal GroupView hands its transcript. It
  // lands on `lang` rather than on a `key`, so a switch re-renders the words
  // instead of remounting the heading.
  const locale = activeLocale();
  const name = greetingFirstName(state.config?.profile?.name);
  return (
    <header data-home-greeting="" lang={locale} className="hidden shrink-0 px-6 pb-1 pt-5 text-center lg:block">
      <h1 className="text-[34px] font-semibold leading-10 tracking-[-0.02em] text-ink">
        {name ? `${t(greetingKey)}, ${name}` : t(greetingKey)}
      </h1>
      <p className="mt-1 text-[15px] leading-[22px] text-ink-secondary">{t("home.greeting.assistant", { name: bot.name })}</p>
    </header>
  );
}

export interface HomeScreenProps {
  bot: Bot;
  /** the conversation itself, supplied so the landing never imports a view */
  children: ReactNode;
  /** open the whole workspace — rooms, sections, archived bots, tools */
  onOpenAll: () => void;
  onGoProjects: () => void;
  onShowAutomations: () => void;
}

export function HomeScreen({ bot, children, onOpenAll, onGoProjects, onShowAutomations }: HomeScreenProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col")} data-home-screen="">
      {/* The greeting is a wide-window courtesy. Below `lg` it steps aside so a
          phone spends its height on the conversation, which is what it spent
          it on before the landing existed. */}
      <HomeGreeting bot={bot} />
      <div className="flex min-h-0 flex-1 gap-3 lg:px-6 lg:pb-6">
        <HomeRail bot={bot} onOpenAll={onOpenAll} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        <HomeContext onOpenAll={onOpenAll} onGoProjects={onGoProjects} onShowAutomations={onShowAutomations} />
      </div>
    </div>
  );
}