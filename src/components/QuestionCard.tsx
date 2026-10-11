// The question box: what the bot actually asked, and its own answers.
//
// This is the card for a structured ask — Claude's AskUserQuestion. The
// provider routes it through the permission channel, so without this it
// arrived as "Deny / Always allow / Allow once" over a question like "which
// model should this bot run on?", which is not an answer to anything.
//
// One tab per question (the model names them), the model's options as rows
// with their descriptions, an "Other" row for a reply it did not think of,
// and a single submit that sends every answer back at once — the shape a
// person can read at a glance and answer without scrolling back up. A short
// single-choice question drops the descriptions and gets the mockup's row of
// chips instead; `choiceLayout` owns that call.
import { useMemo, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  ChoiceList,
  DecisionCard,
  DecisionInput,
  DecisionReceipt,
  OtherAnswer,
} from "@/components/DecisionCard";
import {
  answerWithoutPreamble,
  formatQuestionAnswers,
  MAX_CUSTOM_ANSWER,
  type AskQuestion,
} from "../../shared/ask-question";

/** What each question has been answered with so far. Option labels and the
 * free-text reply are kept apart so toggling "Other" off cannot silently
 * drop a choice the person already made. */
interface Draft {
  picked: string[];
  custom: string;
  /** "Other" is open. An empty open field is not an answer. */
  other: boolean;
}

const EMPTY: Draft = { picked: [], custom: "", other: false };

function answersOf(draft: Draft): string[] {
  const custom = draft.other ? draft.custom.trim() : "";
  return custom ? [...draft.picked, custom] : draft.picked;
}

/** The tab label: the model's own header, or a number when it gave none. */
function tabLabel(question: AskQuestion, index: number): string {
  return question.header ?? t("question.tab.numbered", { index: index + 1 });
}

export function QuestionCard({
  threadId,
  bot,
  message,
}: {
  /** answered by THREAD, so a question raised inside a room settles the
   * same way as one in a 1:1 chat */
  threadId: string;
  /** who is asking, for the "Name has a question" line */
  bot?: Bot;
  message: Message;
}) {
  const { dispatch } = useStore();
  const card = message.card;
  const questions = card?.questionRequest?.questions ?? [];
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [active, setActive] = useState(0);
  // The server settles the card, but only after a round trip. Holding the
  // sent answer here closes the window where the buttons are still live.
  const [sent, setSent] = useState<string | null>(null);

  const answered = useMemo(
    () => questions.map((_, index) => answersOf(drafts[index] ?? EMPTY).length > 0),
    [questions, drafts],
  );

  if (!card || !questions.length) return null;
  const settled = Boolean(card.answered) || sent !== null;
  const current = questions[Math.min(active, questions.length - 1)]!;
  const currentIndex = Math.min(active, questions.length - 1);
  const draft = drafts[currentIndex] ?? EMPTY;
  const answeredCount = answered.filter(Boolean).length;
  const complete = answeredCount === questions.length;

  const update = (index: number, next: Partial<Draft>) =>
    setDrafts((previous) => ({ ...previous, [index]: { ...(previous[index] ?? EMPTY), ...next } }));

  const choose = (label: string) => {
    if (settled) return;
    if (current.multiSelect) {
      const picked = draft.picked.includes(label)
        ? draft.picked.filter((entry) => entry !== label)
        : [...draft.picked, label];
      update(currentIndex, { picked });
      return;
    }
    // Single-select is a radio group: picking replaces, and picking an
    // option means the free-text answer was not the one they wanted.
    update(currentIndex, { picked: [label], other: false });
    // Move to the next question they still owe an answer to, the way the
    // tabs would have been clicked anyway. The last one stays put so the
    // submit button is under the cursor that just chose.
    const next = questions.findIndex((_, index) => index !== currentIndex && !answered[index]);
    if (next >= 0) setActive(next);
  };

  const toggleOther = () => {
    if (settled) return;
    if (draft.other) {
      update(currentIndex, { other: false });
      return;
    }
    update(currentIndex, { other: true, ...(current.multiSelect ? {} : { picked: [] }) });
  };

  const submit = () => {
    if (settled || !complete || !card.requestId) return;
    const answer = formatQuestionAnswers(questions, questions.map((_, index) => answersOf(drafts[index] ?? EMPTY)));
    if (!answer) return;
    setSent(answer);
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: card.requestId,
      behavior: "answer",
      message: answer,
      // The answer never reached the bot, so the card must go back to
      // being answerable rather than sitting there looking settled.
      onError: () => setSent(null),
    });
  };

  return (
    <DecisionCard
      role="group"
      aria-label={t("question.aria.card")}
      settled={settled}
      glyph={<MessageCircleQuestion size={17} aria-hidden="true" className="text-ink-secondary" />}
      title={bot ? t("question.card.named", { name: bot.name }) : t("question.card.title")}
      aside={
        questions.length > 1
          ? t("question.progress", { answered: answeredCount, count: questions.length })
          : undefined
      }
      footer={
        settled ? (
          <DecisionReceipt
            settled
            allow={(() => {
              const answer = card.answeredText ?? sent;
              return answer ? answerWithoutPreamble(answer) : t("question.status.answered");
            })()}
            deny={t("question.status.answered")}
            waiting={t("question.status.waiting")}
          />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
              <MessageCircleQuestion size={14} aria-hidden="true" className="text-accent" />
              {t("question.status.waiting")}
            </span>
            <button
              onClick={submit}
              disabled={!complete}
              className="rounded-full bg-accent px-4 py-1.5 text-[13.5px] font-medium text-white outline-none transition-colors duration-[var(--motion-fast)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {questions.length > 1 ? t("question.submitAll") : t("question.submit")}
            </button>
          </div>
        )
      }
    >
      {questions.length > 1 && (
        <div role="tablist" aria-label={t("question.aria.tabs")} className="mt-2.5 flex flex-wrap gap-1">
          {questions.map((question, index) => (
            <button
              key={`${index}-${question.question}`}
              role="tab"
              aria-selected={index === currentIndex}
              onClick={() => setActive(index)}
              className={
                index === currentIndex
                  ? "rounded-full bg-accent/12 px-3 py-1 text-[13px] font-medium text-accent outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60"
                  : "rounded-full px-3 py-1 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-control/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              }
            >
              {answered[index] && <span aria-hidden="true" className="me-1 text-success">✓</span>}
              {tabLabel(question, index)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 text-[15px] leading-relaxed text-ink">{current.question}</div>
      {current.multiSelect && !settled && (
        <div className="mt-1 text-[12.5px] text-ink-secondary">{t("question.multiHint")}</div>
      )}

      {!settled && (
        <ChoiceList
          question={current.question}
          options={current.options}
          picked={draft.picked}
          multiSelect={Boolean(current.multiSelect)}
          onChoose={choose}
          onOther={toggleOther}
          otherOpen={draft.other}
          otherLabel={t("question.other")}
        >
          {draft.other && (
            <OtherAnswer>
              <DecisionInput
                autoFocus
                value={draft.custom}
                maxLength={MAX_CUSTOM_ANSWER}
                onChange={(event) => update(currentIndex, { custom: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && complete) submit();
                }}
                placeholder={t("question.otherPlaceholder")}
                aria-label={t("question.otherPlaceholder")}
              />
            </OtherAnswer>
          )}
        </ChoiceList>
      )}
    </DecisionCard>
  );
}

