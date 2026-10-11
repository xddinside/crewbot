// A settled turn's intermediate assistant messages. Providers such as Grok
// narrate before tools; the messages stay available without looking like six
// separate final answers after the turn is done.
import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";

export function TurnNarrationRun({
  label,
  forceOpen = false,
  children,
}: {
  label: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? "Hide progress messages" : "Show progress messages"}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-ink-secondary outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised-hover/50 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Check size={13} className="shrink-0 text-success" />
          <span>{label}</span>
          <ChevronRight size={13} aria-hidden="true" className={cn("shrink-0 transition-transform duration-[var(--motion-fast)]", open && "rotate-90")} />
        </button>
      </div>
      {open && children}
    </div>
  );
}
