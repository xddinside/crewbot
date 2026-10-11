export type ComposerSlashCommandId = "goal" | "learn" | "setup";

export interface ComposerSlashCommand {
  id: ComposerSlashCommandId;
  label: `/${ComposerSlashCommandId}`;
  description: string;
}

/* ── The mode menu ───────────────────────────────────────────────────────── */

export type ComposerModeId = "chat" | ComposerSlashCommandId;

export interface ComposerModeOption {
  id: ComposerModeId;
  /** false when this conversation cannot do it — the menu says so rather
   *  than hiding the row, because "why is there no Goal here" is a question
   *  people ask. */
  available: boolean;
}

export interface ComposerModeAvailability {
  /** a room that is not a DM: only a room has a team to run a goal */
  room: boolean;
  /** skill authoring, and somebody here with the agents tools */
  learn: boolean;
  /** a 1:1 conversation with an engine that has the agents tools: only one
   *  assistant can interview you into itself */
  setup: boolean;
}

/**
 * The four ways a message can go out, in the order the menu shows them.
 *
 * The gates live here, once, so the slash picker typed into the box and the
 * mode menu clicked in the toolbar can never disagree: `/goal` disappears in
 * a direct chat and the Goal row goes with it, `/setup` only exists for one
 * assistant, and Learn waits on the flag and the engine that can teach.
 */
export function composerModeOptions({
  room,
  learn,
  setup,
}: ComposerModeAvailability): ComposerModeOption[] {
  return [
    { id: "chat", available: true },
    { id: "goal", available: room },
    { id: "learn", available: learn },
    { id: "setup", available: setup },
  ];
}

export interface ComposerSlashTrigger {
  query: string;
  start: number;
  end: number;
}

/** Slash commands configure the whole send, so they are offered only at the
 * beginning of a draft and only while the first token is being typed. */
export function composerSlashTrigger(
  text: string,
  caretInput: number,
): ComposerSlashTrigger | null {
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  const prefix = text.slice(0, caret);
  const match = /^\/([a-z-]*)$/i.exec(prefix);
  if (!match) return null;
  return { query: match[1] ?? "", start: 0, end: caret };
}

/** A typed `/goal …` is equivalent to selecting Goal mode from the menu.
 * null means this is an ordinary chat message; an empty string means the
 * command is present but still needs a goal description or attachment. */
export function goalTextFromComposer(text: string): string | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trimStart() : null;
}

/** Replace the active slash token and return the caret position immediately
 * after the inserted text. */
export function replaceComposerSlashTrigger(
  text: string,
  trigger: ComposerSlashTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + replacement.length };
}
