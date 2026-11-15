"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { listSavedModels, setKeyModel } from "@/app/actions";
import type { ProviderId } from "@/lib/ai/models";

/**
 * Change the model of a key that is already saved, without pasting the key again. The models come from the
 * provider, asked with the saved key on the server; typing filters the list (and any name can be typed).
 */
export function KeyModel({ provider, model }: { provider: ProviderId; model: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [value, setValue] = useState(model);
  const [saving, setSaving] = useState(false);

  async function start() {
    setOpen(true);
    setValue(model);
    if (models) return;
    setNote("Checking which models this key can use…");
    const r = await listSavedModels(provider).catch(() => ({ error: "Couldn't list models. You can still type a model name." }) as { models?: string[]; error?: string });
    setModels(r.models ?? []);
    setNote(r.models ? `${r.models.length} models available with this key.` : r.error ?? "");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === model) return setOpen(false);
    setSaving(true);
    const r = await setKeyModel(provider, next);
    setSaving(false);
    if (r?.error) return void toast.error(r.error);
    toast.success(`Now using ${next}`);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return <button type="button" className="btn-ghost h-9 px-4" onClick={start}>Change model</button>;

  return (
    <form onSubmit={save} className="flex w-full flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`model-${provider}`}>Model</label>
      <input
        id={`model-${provider}`} className="input h-9 min-w-0 flex-1 font-mono text-sm" list={`saved-models-${provider}`} autoFocus
        value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} required
        onFocus={(e) => e.currentTarget.select()}
      />
      <datalist id={`saved-models-${provider}`}>
        {(models ?? []).map((m) => <option key={m} value={m} />)}
      </datalist>
      <button className="btn-primary h-9 px-4" disabled={saving}>{saving ? "Checking…" : "Save"}</button>
      <button type="button" className="btn-ghost h-9 px-4" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
      {note && <p className="w-full text-xs text-dim" aria-live="polite">{note}</p>}
    </form>
  );
}
