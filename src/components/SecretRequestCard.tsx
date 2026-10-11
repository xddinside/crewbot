import { useState, type FormEvent } from "react";
import { Check, ExternalLink, Loader2, LockKeyhole, RefreshCw } from "lucide-react";

import { credentialConfigPatch, credentialResumeOutcome } from "../../shared/credential-request";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore, type ConfigStatus, type Message } from "@/state/store";
import { DecisionCard, DecisionInput } from "./DecisionCard";

/** The one card in the transcript that asks for a secret rather than for a
 *  decision. It reads the same way as the rest — glass, a glyph, a receipt —
 *  and it says plainly that the value never becomes part of the conversation,
 *  because that is the only thing anyone needs to be told before typing a key. */
export function SecretRequestCard({
  botId,
  threadId,
  message,
}: {
  botId: string;
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const secret = message.secret!;
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/secret-cards/${encodeURIComponent(message.id)}`;
  const error = localError ?? secret.error;
  const outcome = credentialResumeOutcome(secret);
  const provided = outcome === "provided";
  const declined = outcome === "dismissed";
  const description = provided
    ? secret.resumed
      ? t("secret.savedResumed")
      : t("secret.savedPending")
    : declined
      ? t("secret.declined")
      : secret.description;
  const footerLabel = declined
    ? t("secret.resumeFailedAfterDecline")
    : secret.resumed
      ? t("secret.resumedBlind")
      : error
        ? t("secret.keySafeResumeFailed")
        : t("secret.waitingToResume");

  // A successful decline has no durable card to show. If its continuation
  // failed, bring the card back with the same retry affordance as a saved key.
  if (declined && (secret.resumed || !error)) return null;

  const notifyProvided = async () => {
    await api(`${endpoint}/provided`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
  };

  const retryResume = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError(null);
    try {
      await api(`${endpoint}/resume`, {
        method: "POST",
        body: JSON.stringify({ threadId }),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || (!value.trim() && !savedLocally)) return;
    setSaving(true);
    setLocalError(null);
    try {
      if (!savedLocally) {
        const next = value.trim();
        const status: ConfigStatus = window.ogb?.setCredential
          ? await window.ogb.setCredential(secret.target, next)
          : await api("/api/config", {
              method: "PUT",
              body: JSON.stringify(credentialConfigPatch(secret.target, next)),
            });
        dispatch({ type: "configStatus", config: status });
        setValue("");
        setSavedLocally(true);
      }
      await notifyProvided();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    void api(`${endpoint}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  };

  const open = !provided && !declined;

  return (
    <div className="flex w-full justify-start">
      <DecisionCard
        data-secret-card=""
        settled={!open}
        className="max-w-[520px]"
        glyph={
          provided ? (
            <Check size={17} aria-hidden="true" className="text-success" />
          ) : (
            <LockKeyhole size={17} aria-hidden="true" className="text-ink-secondary" />
          )
        }
        title={secret.label}
        aside={
          <span className="flex items-center gap-1">
            {provided && <Check size={12} aria-hidden="true" />}
            {open ? t("secret.enterSecurely") : undefined}
          </span>
        }
        footer={
          (provided || declined) && (
            <div
              className={cn(
                "flex items-center justify-between gap-3 text-[11.5px]",
                declined ? "text-danger" : "text-success",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {secret.resumed ? (
                  <Check size={12} aria-hidden="true" />
                ) : error ? (
                  <LockKeyhole size={12} aria-hidden="true" />
                ) : (
                  <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                )}
                {footerLabel}
              </span>
              {!secret.resumed && error && (
                <button
                  onClick={() => void retryResume()}
                  disabled={saving}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white outline-none transition-colors duration-[var(--motion-fast)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} aria-hidden="true" />
                  )}{" "}
                  {t("chat.retry")}
                </button>
              )}
            </div>
          )
        }
      >
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">{description}</p>
        {open && (
          <p className="mt-1 flex items-center gap-1 text-[11.5px] text-ink-secondary/85">
            <LockKeyhole size={11} aria-hidden="true" /> {t("secret.storedSecurely")}
          </p>
        )}
        {error && open && (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {error}
          </p>
        )}

        {remoteClient && open && (
          <div className="mt-2.5 rounded-lg bg-inset/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-secondary">
            {t("secret.mustBeHost")}
          </div>
        )}
        {!remoteClient && open && (
          <form onSubmit={(event) => void save(event)} className="mt-2.5">
            <div className="flex gap-2">
              <DecisionInput
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={secret.placeholder}
                disabled={saving || savedLocally}
                aria-label={secret.label}
              />
              <button
                type="submit"
                disabled={saving || (!value.trim() && !savedLocally)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-white outline-none transition-colors duration-[var(--motion-fast)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={13} aria-hidden="true" className="animate-spin" />
                ) : (
                  <LockKeyhole size={13} aria-hidden="true" />
                )}
                {savedLocally ? t("secret.continueTask") : t("secret.saveSecurely")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("secret.notNow")}
                title={t("secret.notNow")}
                className="shrink-0 rounded-lg border border-hairline/55 px-3 py-2 text-[12.5px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {t("secret.notNow")}
              </button>
            </div>
            <a
              href={secret.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
            >
              {t("secret.whereToGet")} <ExternalLink size={11} aria-hidden="true" />
            </a>
          </form>
        )}
      </DecisionCard>
    </div>
  );
}
