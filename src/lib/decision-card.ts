// How a decision card lays its own choices out, and what its chrome says.
//
// Pure on purpose: the approval, question, option and credential cards are the
// only four surfaces in the transcript that ask a person to decide something,
// and the rule that decides between a row of chips and a column of rows is the
// one thing about them that is a judgement rather than a preference. Keeping it
// here means the rule is tested and the four cards cannot each invent an
// answer.

export interface ChoiceOption {
  label: string;
  description?: string;
}

/** A chip row reads at a glance but stops reading the moment it wraps, so the
 *  limits are about one line of chips rather than about screen width: four
 *  choices and a label that fits. Anything past that becomes a column. */
const CHIP_MAX_OPTIONS = 4;
const CHIP_MAX_LABEL = 24;

/**
 * `chips` — the mockup's segmented row: a short single-choice question whose
 * options carry no explanation ("7 days / 30 days / Other").
 *
 * `rows` — a column, because a description needs its own line or a
 * multi-select needs a visible tick target wider than the circle.
 *
 * Multi-select is always rows: two ticked chips in a wrapping row read as a
 * sentence with a hole in it.
 */
export function choiceLayout(
  options: readonly ChoiceOption[],
  multiSelect: boolean,
): "chips" | "rows" {
  if (multiSelect || options.length === 0 || options.length > CHIP_MAX_OPTIONS) return "rows";
  return options.every(
    (option) => !option.description?.trim() && Array.from(option.label).length <= CHIP_MAX_LABEL,
  )
    ? "chips"
    : "rows";
}
