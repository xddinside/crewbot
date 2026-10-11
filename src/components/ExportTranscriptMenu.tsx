import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Download, Ellipsis } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { messageMenuRowClass } from "./MessageActions";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import { glassClass } from "./Glass";
import type { Message } from "@/state/store";

export interface ExportTranscriptMenuProps {
  /** Title of the conversation (bot name or channel name). */
  title: string;
  /** Messages to export. */
  messages: readonly Message[];
  /** Optional fallback bot name for 1:1 chats. */
  botName?: string;
  /** Whether this is a group room / channel. */
  isGroup?: boolean;
  /** Optional custom CSS classes for the trigger button. */
  className?: string;
  /** Rows the caller adds after the export pair — the Inspector in a direct
   *  chat, nothing in a room, which has none. */
  extraItems?: readonly ConversationOverflowItem[];
}

export interface ConversationOverflowItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Renders the row pressed, for a panel that is already open. */
  pressed?: boolean;
}

/**
 * The conversation header's `…`.
 *
 * F038 asks for the export to live in a header ellipsis submenu, and the
 * mockup draws exactly that: Copy Markdown · Download .md · Inspector. Both
 * exports and — where there is one — the Inspector used to be two more icons
 * in the row; they are named rows here instead, so the row of icons stays
 * short enough to hold a title, a stop button, a model and a usage figure.
 *
 * Markdown export is the only way out of a conversation: there is no public
 * share link and none is invented here.
 */
export function ConversationOverflowMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
  extraItems,
}: ExportTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const hasMessages = messages && messages.length > 0;
  const markdown = () => formatTranscriptMarkdown({ title, messages, botName, isGroup });

  /** Copy formatted Markdown transcript to clipboard with visual feedback. */
  const handleCopy = async () => {
    if (!hasMessages) return;
    const success = await copyTranscriptToClipboard(markdown());
    setCopyFailed(!success);
    if (success) {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  /** Trigger browser download for the formatted Markdown transcript file. */
  const handleDownload = () => {
    if (!hasMessages) return;
    downloadMarkdownTranscript(slugifyTranscriptFilename(title), markdown());
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("chat.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "rounded-md p-1.5 transition-colors hover:bg-raised/60",
          open ? "bg-raised/70 text-ink" : "text-ink-secondary hover:text-ink",
          className,
        )}
        title={t("chat.moreActions")}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>

      {open && (
        <ConversationOverflowRows
          hasMessages={Boolean(hasMessages)}
          copied={copied}
          copyFailed={copyFailed}
          onCopy={() => void handleCopy()}
          onDownload={handleDownload}
          extraItems={extraItems}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The menu's rows, without the trigger, so the labels can be asserted — and
 *  so the sheet below and the menu above cannot drift apart. */
export function ConversationOverflowRows({
  hasMessages,
  copied,
  copyFailed,
  onCopy,
  onDownload,
  extraItems,
  onClose,
}: {
  hasMessages: boolean;
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => void;
  onDownload: () => void;
  extraItems?: readonly ConversationOverflowItem[];
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label={t("chat.moreActions")}
      className={cn(glassClass("popover"), "absolute right-0 top-full z-40 mt-1 w-[228px] overflow-hidden p-1.5")}
    >
      {!hasMessages && <div className="px-2.5 py-1.5 text-[12px] text-ink-secondary">{t("chat.exportEmpty")}</div>}
      <button
        type="button"
        role="menuitem"
        disabled={!hasMessages}
        onClick={onCopy}
        className={cn(messageMenuRowClass, "text-ink hover:bg-raised/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent")}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{copied ? t("chat.exportCopied") : t("chat.exportCopy")}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        disabled={!hasMessages}
        onClick={onDownload}
        className={cn(messageMenuRowClass, "text-ink hover:bg-raised/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent")}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">
          <Download size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate">{t("chat.exportDownload")}</span>
      </button>

      {copyFailed && (
        <div role="status" className="px-2.5 py-1.5 text-[12px] text-ink-secondary">
          {t("chat.exportClipboardFailed")}
        </div>
      )}

      {extraItems?.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          aria-pressed={item.pressed}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={cn(
            messageMenuRowClass,
            "mt-1.5 border-t border-hairline/30 pt-2 text-ink hover:bg-raised/70",
            item.pressed && "text-accent",
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

