import { Loader2, Square, Volume2 } from "lucide-react";

import { speaker } from "@/lib/tts";
import { localSystemVoiceActive } from "@/lib/local-voice";
import { useSpeech } from "@/lib/tts/useSpeech";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { messageMenuRowClass } from "./MessageActions";

/** Read one message aloud. Hover-revealed beside the copy control, and it
 * becomes a stop button while this message is the one speaking — the same
 * button, because "speak" and "shut up" are the same intent twice.
 *
 * Without a key it stays visible but disabled, saying what it needs: a
 * hidden button is a feature nobody discovers. */
export function SpeakButton({
  text,
  botId,
  messageId,
  voiceId,
  className,
  variant = "icon",
}: {
  text: string;
  botId?: string;
  messageId: string;
  voiceId?: string;
  className?: string;
  /** `row` is the message menu's named entry; `icon` is the bare control the
   *  menu replaced. One state machine either way. */
  variant?: "icon" | "row";
}) {
  const { state } = useStore();
  const speech = useSpeech();
  const tts = state.config?.tts;
  const localVoice = localSystemVoiceActive();
  const configured = localVoice || Boolean(tts?.configured);
  const ready = localVoice || (configured && Boolean(voiceId || tts?.voice));
  const mine = speech.messageId === messageId && speech.status !== "idle";
  const preparing = mine && speech.status === "preparing";

  const label = !configured
    ? t((tts?.provider ?? "elevenlabs") === "elevenlabs" ? "chat.speak.needsKey" : "chat.speak.needsSetup")
    : !ready
      ? t("chat.speak.needsVoice")
    : mine
      ? t("chat.speak.stop")
      : t("chat.speak.read");
  if (variant === "row") {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (mine) return speaker.stop();
          void speaker.speak(text, { botId, messageId, voiceId });
        }}
        disabled={!ready}
        aria-label={label}
        className={cn(
          messageMenuRowClass,
          "py-2",
          mine ? "text-accent" : "text-ink hover:bg-raised/70",
          !ready && "cursor-not-allowed opacity-60 hover:bg-transparent",
          className,
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">
          {preparing ? <Loader2 size={14} className="animate-spin" /> : mine ? <Square size={14} className="fill-current" /> : <Volume2 size={14} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }
  return (
    <button
      onClick={() => {
        if (mine) return speaker.stop();
        void speaker.speak(text, { botId, messageId, voiceId });
      }}
      disabled={!ready}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-ink-secondary transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-secondary",
        // stays visible while speaking — a stop button you have to hunt for
        // is not a stop button
        mine ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      {preparing ? <Loader2 size={14} className="animate-spin" /> : mine ? <Square size={14} className="fill-current" /> : <Volume2 size={14} />}
    </button>
  );
}
