"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import type { ActionState } from "@/app/actions";

/**
 * A button that opens a confirm dialog (native <dialog>: focus trap, Esc, backdrop) before a destructive action.
 * The dialog is only mounted while open, so long lists don't carry one hidden dialog per row.
 * `action` errors and failures toast and keep the dialog open; `onDone` runs (awaited) only after success.
 */
export function ConfirmButton({
  action, title, description, confirmLabel = "Delete", children, className = "btn-danger h-9 px-4", ariaLabel, onDone,
}: {
  action: () => Promise<ActionState | void>;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  onDone?: () => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const descId = useId();

  async function confirm() {
    setPending(true);
    let result: ActionState | void;
    try {
      result = await action();
    } catch {
      setPending(false);
      return toast.error("Something went wrong. Nothing was changed; try again.");
    }
    if (result?.error) {
      setPending(false);
      return toast.error(result.error);
    }
    // The action succeeded. Follow-up UI work failing must not read as "the delete failed".
    try {
      await onDone?.();
    } catch (e) {
      console.error("confirm onDone failed", e);
      toast.info("Done. Reload the page to see the change.");
    }
    setPending(false);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className={className} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <dialog
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          aria-labelledby={titleId}
          aria-describedby={descId}
          onClose={() => setOpen(false)}
          onCancel={(e) => pending && e.preventDefault()}
          onClick={(e) => e.target === e.currentTarget && !pending && setOpen(false)}
          className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-line bg-ink-2 p-0 text-paper shadow-2xl backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
        >
          <div className="p-6 sm:p-7">
            <h2 id={titleId} className="display text-2xl">{title}</h2>
            <div id={descId} className="mt-3 text-sm leading-relaxed text-muted">{description}</div>
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)} autoFocus>
                Cancel
              </button>
              <button type="button" className="btn-danger bg-heart/10" disabled={pending} onClick={confirm}>
                {pending ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
