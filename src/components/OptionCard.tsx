import { useState } from "react";
import { ListChecks, X } from "lucide-react";
import { useStore, visibleMessages, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { parseChoices } from "../../shared/ask-question";
import {
  ChoiceList,
  DecisionCard,
  DecisionInput,
  DecisionReceipt,
  type ChoiceOption,
} from "./DecisionCard";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** First-run quiz, not a live provider ask (those carry requestId). */
export function isOnboardingCard(message: Message): boolean {
  return message.kind === "options" && !!message.card && !message.card.requestId;
}

/** Hide the quiz once they have talked past it — picked an option, typed in
 * the composer, or dismissed it. Live asks are never this card. */
export function shouldHideOnboardingCard(message: Message, transcript: Message[]): boolean {
  if (!isOnboardingCard(message) || !message.card) return false;
  if (message.card.dismissed || message.card.answered) return true;
  const index = transcript.findIndex((entry) => entry.id === message.id);
  if (index < 0) return false;
  return transcript.slice(index + 1).some((later) => later.role === "user" && later.kind === "text");
}

export function OptionCard({
  botId,
  threadId,
  message,
  /** set when the card is in a room: the answer belongs to the room's thread */
  groupId,
}: {
  botId: string;
  threadId?: string;
  message: Message;
  groupId?: string;
}) {
  const { state, dispatch } = useStore();
  const [custom, setCustom] = useState("");
  const card = message.card;
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const transcript = bot ? visibleMessages(bot) : [];
  // Full thread, not the mounted window: a search-focus slice can omit the
  // later user message that means they already talked past this quiz.
  if (!card || shouldHideOnboardingCard(message, transcript)) return null;

  const title = card.title;
  const subtitle = card.subtitle;
  // Cards saved before the server flattened `ask_user` choices can still hold
  // `{ label }` rows; a label is drawable, an object as a React child is not.
  const options = parseChoices(card.options, LETTERS.length) ?? [];

  const answer = (text: string) => {
    if (!text.trim()) return;
    dispatch({ type: "answerCard", botId, threadId, messageId: message.id, answer: text.trim(), groupId });
  };

  const chosen = (card.answeredText ?? card.answered) ?? "";
  return (
    <DecisionCard
      settled={Boolean(card.answered || card.dismissed)}
      glyph={<ListChecks size={17} aria-hidden="true" className="text-ink-secondary" />}
      title={title}
      aside={
        <button
          onClick={() =>
            dispatch({ type: "dismissCard", botId, threadId, messageId: message.id, groupId })
          }
          aria-label={t("onboarding.card.dismiss")}
          title={t("onboarding.card.dismiss")}
          className="-me-1 rounded-md p-1 text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-control hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <X size={15} aria-hidden="true" />
        </button>
      }
      footer={card.answered ? <DecisionReceipt settled allow={chosen} deny={chosen} waiting="" /> : undefined}
    >
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">{subtitle}</p>

      <ChoiceList
        question={title}
        options={options.map((label): ChoiceOption => ({ label }))}
        picked={chosen ? [chosen] : []}
        multiSelect={false}
        disabled={Boolean(card.answered)}
        onChoose={answer}
        marker={(option, checked) => (
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
              checked ? "border-accent bg-accent text-[var(--color-accent-ink)]" : "border-hairline/55 bg-control text-ink-secondary",
            )}
          >
            {LETTERS[options.indexOf(option.label)] ?? ""}
          </span>
        )}
      />

      {/* a permission ask has no free-text answer — the broker only accepts
          allow/deny, so typing here used to fail silently */}
      {!card.answered && !card.tool && (
        <DecisionInput
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && answer(custom)}
          placeholder={t("onboarding.card.custom")}
          aria-label={t("onboarding.card.custom")}
          className="mt-2.5 text-[14px]"
        />
      )}
    </DecisionCard>
  );
}
