"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { savePerson, type ActionState } from "@/app/actions";
import { RELATIONS } from "@/lib/ai/prompt";

type Person = { id: string; name: string; relation: string; gender: string; notes: string | null };

export function PersonForm({ person, onDone }: { person?: Person; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePerson, undefined);

  useEffect(() => {
    if (state?.error) toast.error(state.error);
    if (state?.ok) {
      toast.success("Saved");
      onDone?.();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {person && <input type="hidden" name="id" value={person.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" className="input" placeholder="Riya" defaultValue={person?.name} required maxLength={60} autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="relation">They are my</label>
        <select id="relation" name="relation" className="input" defaultValue={person?.relation ?? "CRUSH"}>
          {Object.entries(RELATIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="gender">Gender</label>
        <select id="gender" name="gender" className="input" defaultValue={person?.gender ?? "FEMALE"}>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="notes">Context (optional)</label>
        <textarea
          id="notes" name="notes" maxLength={1000} rows={3} defaultValue={person?.notes ?? ""}
          className="input h-auto py-3"
          placeholder="Met at college, talking for 2 months, she's been slower to reply lately…"
        />
      </div>
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : person ? "Save changes" : "Add person"}</button>
      </div>
    </form>
  );
}
