"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { listModels, saveKey, type ActionState } from "@/app/actions";
import { detectProvider, PROVIDERS, PROVIDER_IDS, type ProviderId } from "@/lib/ai/models";

/** What the key's provider said it can use. `for`: the provider + key it was asked for, so stale answers are ignored. */
type Listing = { for: string; state: "loading" | "ready" | "failed"; models?: string[]; error?: string };

export function KeyForm({ next }: { next?: string }) {
  const [provider, setProvider] = useState<ProviderId>("GEMINI");
  const [apiKey, setApiKey] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
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

  // Once a whole key is in the box, ask its provider which models it can use. Waits for typing to stop.
  const want = `${provider}:${apiKey.trim()}`;
  const latest = useRef(want);
  useEffect(() => {
    latest.current = want;
    const key = apiKey.trim();
    if (key.length < 20) return;
    const timer = setTimeout(async () => {
      setListing({ for: want, state: "loading" });
      const r = await listModels(provider, key).catch(() => ({ error: "Couldn't list models. You can still type a model name." }) as { models?: string[]; error?: string });
      if (latest.current !== want) return; // the key or provider changed while this was loading
      setListing(r.models ? { for: want, state: "ready", models: r.models } : { for: want, state: "failed", error: r.error });
    }, 500);
    return () => clearTimeout(timer);
  }, [want, provider, apiKey]);
  const list = listing?.for === want ? listing : null;

  // Search over the listed models (OpenRouter has 400+). Selection lives in state so filtering never drops it.
  // Tagged with `want` like the listing, so a new key or provider starts with a fresh search.
  const [search, setSearch] = useState({ for: "", query: "", picked: "" });
  const { query, picked } = search.for === want ? search : { query: "", picked: "" };
  const setPicked = (v: string) => setSearch({ for: want, query, picked: v });
  const all = list?.models ?? [];
  const model = picked || all[0] || "";
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  // Keep the chosen model in the select even when the search hides it, so the select shows what will be saved.
  const options = shown.includes(model) || !model ? shown : [model, ...shown];

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
        <input
          id="apiKey" name="apiKey" type="password" className="input font-mono" placeholder="Paste your key" required autoComplete="off" spellCheck={false}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            // The key says whose it is: pick the provider for the user.
            const found = detectProvider(e.target.value);
            if (found) setProvider(found);
          }}
        />
      </div>

      <div>
        <label className="label" htmlFor="model">Model</label>
        {list?.state === "ready" ? (
          <>
            {all.length > 8 && (
              <input
                type="search" aria-label="Search models" className="input mb-2" placeholder={`Search ${all.length} models`}
                value={query} autoComplete="off" spellCheck={false}
                onChange={(e) => {
                  // Typing narrows the list; pick the first match so the select follows the search.
                  const v = e.target.value.trim().toLowerCase();
                  const first = v && all.find((m) => m.toLowerCase().includes(v));
                  setSearch({ for: want, query: e.target.value, picked: first || picked });
                }}
              />
            )}
            <select id="model" name="model" className="input font-mono" value={model} onChange={(e) => setPicked(e.target.value)} required>
              {options.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {q && !shown.length && <p className="mt-1.5 text-xs text-amber">No model matches “{query.trim()}”.</p>}
          </>
        ) : (
          <>
            <input key={provider} id="model" name="model" className="input font-mono" list={`models-${provider}`} defaultValue={p.models[0]} required />
            <datalist id={`models-${provider}`}>
              {p.models.map((m) => <option key={m} value={m} />)}
            </datalist>
          </>
        )}
        <p className="mt-1.5 text-xs text-dim" aria-live="polite">
          {list?.state === "loading" && "Checking which models this key can use…"}
          {list?.state === "ready" && `${list.models!.length} models available with this ${p.label} key.`}
          {list?.state === "failed" && <span className="text-amber">{list.error}</span>}
          {!list && "Paste your key to see the models it can use."}
        </p>
      </div>

      <button className="btn-primary" disabled={pending}>{pending ? "Checking key…" : "Verify & save"}</button>
    </form>
  );
}
