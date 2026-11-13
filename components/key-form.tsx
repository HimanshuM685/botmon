"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveKey, type ActionState } from "@/app/actions";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "@/lib/ai/models";

export function KeyForm({ next }: { next?: string }) {
  const [provider, setProvider] = useState<ProviderId>("GEMINI");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveKey, undefined);
  const router = useRouter();
  const p = PROVIDERS[provider];

  useEffect(() => {
    if (state?.error) toast.error(state.error);
    if (state?.ok) {
      toast.success("Key verified and saved");
      if (next) router.push(next);
    }
  }, [state, next, router]);

  return (
    <form action={action} className="space-y-5">
      <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDER_IDS.map((id) => (
          <button
            key={id} type="button" role="radio" aria-checked={provider === id} onClick={() => setProvider(id)}
            className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${provider === id ? "border-heart bg-heart/10" : "border-line hover:bg-ink-3"}`}
          >
            <span className="block font-medium">{PROVIDERS[id].label}</span>
            <span className="mt-0.5 block text-xs text-dim">{PROVIDERS[id].hint}</span>
          </button>
        ))}
      </div>
      <input type="hidden" name="provider" value={provider} />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="label mb-0" htmlFor="apiKey">API key</label>
          <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-xs text-heart hover:underline">Get a key ↗</a>
        </div>
        <input id="apiKey" name="apiKey" type="password" className="input font-mono" placeholder="Paste your key" required autoComplete="off" spellCheck={false} />
      </div>

      <div>
        <label className="label" htmlFor="model">Model</label>
        <input key={provider} id="model" name="model" className="input font-mono" list={`models-${provider}`} defaultValue={p.models[0]} required />
        <datalist id={`models-${provider}`}>
          {p.models.map((m) => <option key={m} value={m} />)}
        </datalist>
      </div>

      <button className="btn-primary" disabled={pending}>{pending ? "Checking key…" : "Verify & save"}</button>
    </form>
  );
}
