// Chips for what is attached to the next message, plus the window-wide
// file drop that creates them. A long paste collapses into a card of its
// first lines instead of flooding the composer; a file dropped anywhere
// on the window attaches by path.
import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, File as FileIcon, LoaderCircle, MessageSquareText, X } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  attachmentImageUrl,
  intakeFiles,
  formatSize,
  pasteSummary,
  type Attachment,
  type FileAttachment,
  type ImageAttachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { AttachmentPreviewDialog, previewImage, type PreviewImage } from "./AttachmentPreview";

/** Electron 32 removed File.path — only the preload can name a file. */
export function pathForFile(file: File): string {
  return window.ogb?.getPathForFile?.(file) ?? "";
}

/** Renders pending attachments and their composer actions. */
export function ComposerAttachments({
  items,
  onAdd,
  onRemove,
  onDisplayInChatBox,
  allowImages = true,
  notice,
  onNotice,
  onPendingChange,
  uploadImage,
}: {
  items: Attachment[];
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
  onDisplayInChatBox: (attachment: PasteAttachment) => void;
  allowImages?: boolean;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  onPendingChange?: (pending: boolean) => void;
  uploadImage: (file: File) => Promise<Attachment | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  // dragenter/dragleave fire once per element crossed, so the overlay
  // tracks depth rather than the last event it happened to see
  const depth = useRef(0);
  const callbacks = useRef({ onAdd, onNotice, onPendingChange, allowImages, uploadImage });
  callbacks.current = { onAdd, onNotice, onPendingChange, allowImages, uploadImage };
  const pendingDrops = useRef(new Set<symbol>());

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // without preventDefault the window navigates to the dropped file and
    // the app is simply gone
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      // Same intake the attach button uses: a dropped file and a picked one
      // must not appear in a different order.
      const operation = Symbol("attachment-drop");
      pendingDrops.current.add(operation);
      callbacks.current.onPendingChange?.(true);
      try {
        const { attachments, notice: message } = await intakeFiles(files, {
          allowImages: callbacks.current.allowImages,
          getPath: pathForFile,
          uploadImage: callbacks.current.uploadImage,
        });
        if (attachments.length) callbacks.current.onAdd(attachments);
        if (message) callbacks.current.onNotice(message);
      } finally {
        if (pendingDrops.current.delete(operation)) callbacks.current.onPendingChange?.(false);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/90 px-8 py-6 text-[14px] font-medium text-ink shadow-2xl">
            Drop to attach
          </div>
        </div>
      )}

      {notice && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            onClick={() => onNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {items.map((a) =>
            a.kind === "paste" ? (
              /* A pasted wall of text has nothing to shrink to: the point of the
                 chip is that you can read what you pasted, so it keeps a card
                 while files and images become pills. */
              <PasteChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} onDisplay={onDisplayInChatBox} />
            ) : a.kind === "image" ? (
              <ImageChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} onPreview={setPreview} />
            ) : (
              <FileChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />
            ),
          )}
        </div>
      )}
      {preview && <AttachmentPreviewDialog image={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

/** The shared shape of a chip: a rounded pill on the composer, with the remove
 *  control revealed by hover *and* by focus — `hidden` would take the only way
 *  to drop a chip out of the keyboard's reach. */
function ChipShell({
  title,
  removeLabel,
  onRemove,
  children,
}: {
  title: string;
  removeLabel: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      title={title}
      className="group/chip relative flex items-center gap-2 rounded-full border border-hairline/40 bg-raised/70 py-1 pl-2 pr-7 transition-colors duration-[var(--motion-fast)] hover:border-hairline"
    >
      {children}
      <button
        onClick={onRemove}
        aria-label={removeLabel}
        className="absolute right-1 flex size-5 items-center justify-center rounded-full text-ink-secondary opacity-0 transition-opacity hover:bg-raised-hover hover:text-ink focus-visible:opacity-100 group-hover/chip:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function PasteChip({
  attachment,
  onRemove,
  onDisplay,
}: {
  attachment: PasteAttachment;
  onRemove: () => void;
  onDisplay: (attachment: PasteAttachment) => void;
}) {
  return (
    <div
      title={attachment.text.slice(0, 4000)}
      className="group/chip relative w-[232px] rounded-xl border border-hairline/40 bg-raised/70 p-2.5 transition-colors hover:border-hairline"
    >
      <div className="flex items-center gap-1.5">
        <ClipboardPaste size={12} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="text-[11px] font-medium text-ink-secondary">{pasteSummary(attachment)}</span>
      </div>
      <pre className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.45] text-ink-secondary">
        {attachment.text.slice(0, 400)}
      </pre>
      <button
        type="button"
        onClick={() => onDisplay(attachment)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/25 px-2 py-1 text-[10.5px] font-medium text-accent-text transition-colors hover:border-accent/50 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      >
        <MessageSquareText size={12} aria-hidden="true" />
        <span>{t("composer.paste.display")}</span>
      </button>
      <button
        onClick={onRemove}
        aria-label={t("composer.paste.remove")}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/chip:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function ImageChip({
  attachment,
  onRemove,
  onPreview,
}: {
  attachment: ImageAttachment;
  onRemove: () => void;
  onPreview: (image: PreviewImage | null) => void;
}) {
  return (
    <ChipShell title={attachment.name} removeLabel={t("composer.paste.removeFile")} onRemove={onRemove}>
      <button
        type="button"
        onClick={() => {
          const image = previewImage(attachment.path, attachment.name);
          const src = image?.src ?? attachment.previewUrl;
          if (src) onPreview(image ?? { src, name: attachment.name });
        }}
        disabled={!attachmentImageUrl(attachment.path) && !attachment.previewUrl}
        aria-busy={attachment.uploading || undefined}
        aria-label={`${t("composer.paste.preview")} ${attachment.name}`}
        className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-default"
      >
        <img
          src={attachmentImageUrl(attachment.path) ?? attachment.previewUrl}
          alt={attachment.name}
          loading="eager"
          fetchPriority="high"
          className="size-full object-cover"
        />
        {attachment.uploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/65 text-white">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          </span>
        )}
      </button>
      <span className="max-w-[160px] truncate text-[12.5px] text-ink">{attachment.name}</span>
      <span className="shrink-0 text-[11px] text-ink-secondary/80">
        {attachment.uploading ? t("composer.paste.uploading") : formatSize(attachment.size)}
      </span>
    </ChipShell>
  );
}

function FileChip({ attachment, onRemove }: { attachment: FileAttachment; onRemove: () => void }) {
  return (
    <ChipShell title={attachment.path} removeLabel={t("composer.paste.removeFile")} onRemove={onRemove}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <FileIcon size={12} aria-hidden="true" />
      </span>
      <span className="max-w-[160px] truncate text-[12.5px] text-ink">{attachment.name}</span>
      <span className="shrink-0 text-[11px] text-ink-secondary/80">{formatSize(attachment.size)}</span>
    </ChipShell>
  );
}
