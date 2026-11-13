"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { restoreItem } from "@/app/actions";

export function RestoreButton({ kind, id }: { kind: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost h-9 px-4" disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await restoreItem(kind, id);
          if (r?.error) toast.error(r.error);
          else toast.success("Restored");
        })
      }
    >
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
