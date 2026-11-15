"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveFact, trashItem, type ActionState } from "@/app/actions";
import { syncModel } from "@/lib/model-sync";
import { ConfirmButton } from "./confirm-button";
import { MemoryMap, type MapLink } from "./memory-map";

/** After the timeline changes, bring the read up to date in the background (no chat re-read). */
function updateRead(personId: string) {
  void syncModel(personId).then((r) => {
    if (r.status === "updated" || r.status === "created") toast.success(r.status === "created" ? "Read created from the timeline" : "Read updated", { description: r.whatChanged });
  });
}

type Fact = { id: string; kind: string; text: string; source: string; entities: string[]; feeling: string | null; valence: number | null; happenedAt: string | null; createdAt: string };

const KINDS = { EVENT: "Event", FACT: "Fact", PREFERENCE: "Preference", DATE: "Date" } as const;
const SOURCE = { ANALYSIS: "from a read", COACH: "from coach", USER: "added by you" } as const;
const FELT = { "-2": "Very bad", "-1": "Bad", "0": "Neutral", "1": "Good", "2": "Very good" } as const;
const DOT: Record<string, string> = { EVENT: "bg-heart", FACT: "bg-paper", PREFERENCE: "bg-mint", DATE: "bg-amber" };

export function Timeline({ personId, personName, facts, links, replaced = {} }: {
  personId: string; personName: string; facts: Fact[]; links: MapLink[];
  /** memory id -> text of the older memory it corrected (that one is in the trash) */
  replaced?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  // A person, place or topic picked on the map (or by clicking a tag): only memories about it are listed.
  const [entity, setEntity] = useState<string | null>(null);
  const shown = facts.filter((f) => (filter === "ALL" || f.kind === filter) && (!entity || f.entities.includes(entity)));

  return (
    <div className="space-y-8">
      <section className="card p-6 sm:p-8">
        <h2 className="display text-2xl">Add to {personName}&apos;s timeline</h2>
        <p className="mb-5 mt-1 text-sm text-muted">Reads and the coach add details automatically. Anything you add or change here updates the read by itself.</p>
        <FactForm personId={personId} />
      </section>

      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="View">
        {(["list", "map"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${view === v ? "border-heart text-paper" : "border-transparent text-muted hover:text-paper"}`}>
            {v === "list" ? "List" : "Map"}
          </button>
        ))}
      </div>

      {view === "map" && <MemoryMap name={personName} facts={facts} links={links} selected={entity} onSelect={setEntity} />}

      {entity && (
        <p className="text-sm text-muted">
          Showing memories about <span className="chip border-heart/50 text-paper">{entity}</span>{" "}
          <button className="text-heart underline-offset-4 hover:underline" onClick={() => setEntity(null)}>Show all</button>
        </p>
      )}

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
                      {replaced[f.id] && (
                        <p className="mt-1 text-xs text-dim">
                          Replaces: <span className="line-through">{replaced[f.id]}</span>
                        </p>
                      )}
                      <p className="mt-1.5 text-xs text-dim">
                        {KINDS[f.kind as keyof typeof KINDS]}
                        {f.happenedAt && ` · ${new Date(f.happenedAt).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })}`}
                        {` · ${SOURCE[f.source as keyof typeof SOURCE]}`}
                        {f.feeling && <> · <span className={f.valence ? (f.valence > 0 ? "text-mint" : "text-amber") : undefined}>felt {f.feeling}</span></>}
                      </p>
                      {f.entities.length > 0 && (
                        <p className="mt-2 flex flex-wrap gap-1.5">
                          {f.entities.map((e) => (
                            <button key={e} onClick={() => setEntity(entity === e ? null : e)} aria-pressed={entity === e}
                              className={`rounded-full border px-2 py-0.5 text-xs transition ${entity === e ? "border-heart text-paper" : "border-line text-dim hover:text-paper"}`}>
                              {e}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                    <button className="text-xs text-muted hover:text-paper" onClick={() => setEditing(f.id)}>Edit</button>
                    <DeleteFact id={f.id} personId={personId} />
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

function DeleteFact({ id, personId }: { id: string; personId: string }) {
  return (
    <ConfirmButton
      className="text-xs text-muted hover:text-heart"
      action={() => trashItem("fact", id)}
      title="Delete this from the timeline?"
      description="It moves to the trash for 30 days. Reads and the coach won't add it back, even if it comes up again."
      confirmLabel="Move to trash"
      onDone={() => {
        toast.success("Moved to trash"); // trashItem already revalidated this page
        updateRead(personId);
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
      updateRead(personId);
    }
  }, [state, onDone, personId]);

  return (
    <form action={(fd) => { action(fd); if (!fact) setText(""); }} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="personId" value={personId} />
      {fact && <input type="hidden" name="id" value={fact.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`text-${fact?.id ?? "new"}`}>What</label>
        <input id={`text-${fact?.id ?? "new"}`} name="text" className="input" required maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Got her dream internship" />
      </div>
      <div>
        <label className="label" htmlFor={`about-${fact?.id ?? "new"}`}>About</label>
        <input id={`about-${fact?.id ?? "new"}`} name="entities" className="input" maxLength={300} defaultValue={fact?.entities.join(", ") ?? ""} placeholder="sister, job" title="Tags, separated by commas. Memories with the same tag are connected." />
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
      <div>
        <label className="label" htmlFor={`feeling-${fact?.id ?? "new"}`}>How they felt</label>
        <input id={`feeling-${fact?.id ?? "new"}`} name="feeling" className="input" maxLength={24} defaultValue={fact?.feeling ?? ""} placeholder="hurt, excited" title="Optional. One or two words for how they felt about it." />
      </div>
      <div>
        <label className="label" htmlFor={`valence-${fact?.id ?? "new"}`}>For them it was</label>
        <select id={`valence-${fact?.id ?? "new"}`} name="valence" className="input" defaultValue={String(fact?.valence ?? 0)} title="Only saved together with a feeling.">
          {Object.entries(FELT).sort((a, b) => Number(a[0]) - Number(b[0])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : fact ? "Save" : "Add"}</button>
        {fact && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}
