"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveFact, trashItem, type ActionState } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

type Fact = { id: string; kind: string; text: string; source: string; happenedAt: string | null; createdAt: string };

const KINDS = { EVENT: "Event", FACT: "Fact", PREFERENCE: "Preference", DATE: "Date" } as const;
const SOURCE = { ANALYSIS: "from a read", COACH: "from coach", USER: "added by you" } as const;
const DOT: Record<string, string> = { EVENT: "bg-heart", FACT: "bg-paper", PREFERENCE: "bg-mint", DATE: "bg-amber" };

export function Timeline({ personId, personName, facts }: { personId: string; personName: string; facts: Fact[] }) {
  const [filter, setFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const shown = filter === "ALL" ? facts : facts.filter((f) => f.kind === filter);

  return (
    <div className="space-y-8">
      <section className="card p-6 sm:p-8">
        <h2 className="display text-2xl">Add to {personName}&apos;s timeline</h2>
        <p className="mb-5 mt-1 text-sm text-muted">Reads and the coach add details automatically. Everything here is used in future reads and chats.</p>
        <FactForm personId={personId} />
      </section>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filter">
        {["ALL", ...Object.keys(KINDS)].map((k) => (
          <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${filter === k ? "border-heart bg-heart text-ink" : "border-line text-muted hover:text-paper"}`}>
            {k === "ALL" ? `All (${facts.length})` : KINDS[k as keyof typeof KINDS]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card p-8 text-center text-muted">Nothing here yet. Run a read or tell the coach what&apos;s happening.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-6">
          {shown.map((f) => (
            <li key={f.id} className="relative">
              <span className={`absolute -left-[29px] top-5 size-2.5 rounded-full ${DOT[f.kind]}`} />
              <div className="card p-4">
                {editing === f.id ? (
                  <FactForm personId={personId} fact={f} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed">{f.text}</p>
                      <p className="mt-1.5 text-xs text-dim">
                        {KINDS[f.kind as keyof typeof KINDS]}
                        {f.happenedAt && ` · ${new Date(f.happenedAt).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })}`}
                        {` · ${SOURCE[f.source as keyof typeof SOURCE]}`}
                      </p>
                    </div>
                    <button className="text-xs text-muted hover:text-paper" onClick={() => setEditing(f.id)}>Edit</button>
                    <DeleteFact id={f.id} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DeleteFact({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="text-xs text-muted hover:text-heart"
      action={() => trashItem("fact", id)}
      title="Delete this from the timeline?"
      description="It moves to the trash for 30 days. Reads and the coach won't add it back, even if it comes up again."
      confirmLabel="Move to trash"
      onDone={() => {
        toast.success("Moved to trash");
        router.refresh();
      }}
    >
      Delete
    </ConfirmButton>
  );
}

function FactForm({ personId, fact, onDone }: { personId: string; fact?: Fact; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFact, undefined);
  const [text, setText] = useState(fact?.text ?? "");

  useEffect(() => {
    if (state?.error) toast.error(state.error);
    if (state?.ok) {
      toast.success("Saved");
      onDone?.();
    }
  }, [state, onDone]);

  return (
    <form action={(fd) => { action(fd); if (!fact) setText(""); }} className="grid gap-3 sm:grid-cols-[1fr_160px_160px_auto] sm:items-end">
      <input type="hidden" name="personId" value={personId} />
      {fact && <input type="hidden" name="id" value={fact.id} />}
      <div>
        <label className="label" htmlFor={`text-${fact?.id ?? "new"}`}>What</label>
        <input id={`text-${fact?.id ?? "new"}`} name="text" className="input" required maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Got her dream internship" />
      </div>
      <div>
        <label className="label" htmlFor={`kind-${fact?.id ?? "new"}`}>Type</label>
        <select id={`kind-${fact?.id ?? "new"}`} name="kind" className="input" defaultValue={fact?.kind ?? "EVENT"}>
          {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`date-${fact?.id ?? "new"}`}>When</label>
        <input id={`date-${fact?.id ?? "new"}`} name="happenedAt" type="date" className="input" defaultValue={fact?.happenedAt ?? ""} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : fact ? "Save" : "Add"}</button>
        {fact && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}
