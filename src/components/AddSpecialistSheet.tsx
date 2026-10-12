// "Add a specialist" — the one door into creating crew.
//
// Three ways in, and they are the three ways the app actually had: write a
// bot here, take a team from the library, or import one somebody built. The
// first is the real role picker (`NewBotChoices`), so `⌘N`, the sidebar's plus
// menu and this sheet all create through one code path and cannot drift.
//
// The sheet is presentation. It does not gain fields the store cannot honour:
// a new bot's team is set by *Move to team* (in every bot menu, here included),
// its model by its Model section, its working folder by its Access section and
// its avatar by its Identity section. Inventing those controls here would
// mean a second place that writes the same fields and disagrees with it.

import { useEffect, useRef, useState } from "react";
import { Library, Loader2, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { track } from "@/lib/analytics";
import type { BotRole } from "@/lib/bot-roles";
import { useStore } from "@/state/store";
import { GlassSheet } from "./Glass";
import { NewBotChoices } from "./NewBotDialog";

const TABS = ["create", "library", "import"] as const;
type SheetTab = (typeof TABS)[number];

const TAB_LABEL: Record<SheetTab, LocaleKey> = {
  create: "crew.add.create",
  library: "crew.add.library",
  import: "crew.add.import",
};

export function AddSpecialistSheet({
  teamLabel,
  onClose,
  onOpenLibrary,
  returnFocusRef,
}: {
  /** the team this was opened under, when it came from a roster column.
   *  Membership is set by *Move to team* — a new bot has no team until it is
   *  moved — so this is said in words rather than offered as a creation field
   *  the store cannot honour. */
  teamLabel?: string | null;
  onClose: () => void;
  /** open the real team library; the sheet passes which tab it wants */
  onOpenLibrary: (tab: "explore" | "import") => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const { state, dispatch } = useStore();
  /* Team creation, the library and the archive are host-only — a remote client
     keeps New bot but not the controls that would need the host's filesystem. */
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const dialogRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const creating = state.botCreationPending;
  const [tab, setTab] = useState<SheetTab>("create");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      alive.current = false;
      window.removeEventListener("keydown", onKeyDown);
      // The trigger may be a button on the roster that has since re-rendered;
      // only take the focus back when it is still there.
      if (previous?.isConnected) previous.focus();
      else returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  const create = (role?: BotRole) => {
    if (creating) return;
    setError(null);
    dispatch({
      type: "newBot",
      role,
      onCreated: () => {
        track("bot_created", { role: role?.id ?? "blank" });
        if (alive.current) onClose();
      },
      onError: (message: string) => {
        if (alive.current) setError(message);
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/20 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <GlassSheet
        ref={dialogRef as React.RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-busy={creating}
        aria-labelledby="add-specialist-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden outline-none"
        data-add-specialist=""
      >
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5">
          <h2 id="add-specialist-title" className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {t("crew.add.title")}
          </h2>
          {creating ? (
            <Loader2 aria-hidden="true" size={18} className="mt-1 shrink-0 animate-spin text-ink-secondary" />
          ) : (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="-me-1 rounded-lg p-1.5 text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <X size={18} />
            </button>
          )}
        </header>

        <div role="tablist" aria-label={t("crew.add.title")} className="flex shrink-0 items-center gap-1 px-5 pt-4">
          {TABS.filter((id) => !remoteClient || id === "create").map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`add-specialist-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="add-specialist-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium outline-none transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-accent/60",
                tab === id ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>

        <div
          id="add-specialist-panel"
          role="tabpanel"
          aria-labelledby={`add-specialist-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === "create" && (
            <>
              <div className="space-y-1.5 px-5 pt-3">
                <p className="text-[13px] leading-relaxed text-ink-secondary">{t("newBot.intro")}</p>
                {teamLabel && <p className="text-[12.5px] text-ink-secondary">{t("crew.add.addFor", { name: teamLabel })}</p>}
              </div>
              <NewBotChoices creating={creating} error={error} onCreate={create} />
            </>
          )}
          {tab === "library" && (
            <div className="space-y-4 overflow-y-auto px-5 py-5">
              <p className="text-[13px] leading-relaxed text-ink-secondary">{t("crew.add.libraryHint")}</p>
              <button
                type="button"
                onClick={() => { onClose(); onOpenLibrary("explore"); }}
                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Library size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                {t("crew.add.openLibrary")}
              </button>
              <button
                type="button"
                onClick={() => { onClose(); onOpenLibrary("import"); }}
                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <UploadCloud size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                {t("crew.add.openImport")}
              </button>
            </div>
          )}
          {tab === "import" && (
            <div className="space-y-4 overflow-y-auto px-5 py-5">
              <p className="text-[13px] leading-relaxed text-ink-secondary">{t("crew.add.importHint")}</p>
              <button
                type="button"
                onClick={() => { onClose(); onOpenLibrary("import"); }}
                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <UploadCloud size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                {t("crew.add.openImport")}
              </button>
              <button
                type="button"
                onClick={() => { onClose(); onOpenLibrary("explore"); }}
                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Library size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                {t("crew.add.openLibrary")}
              </button>
            </div>
          )}
        </div>
      </GlassSheet>
    </div>
  );
}