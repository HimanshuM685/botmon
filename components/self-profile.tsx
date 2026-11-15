"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { pinTrait, saveTrait, trashItem, type ActionState } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

type Trait = { id: string; kind: string; text: string; scope: string; relation: string | null; confidence: number; support: number; people: number; source: string; edited: boolean; pinned: boolean; noEvidence: boolean };
type VoiceSummary = { count: number; medianWords: number; lowerStart: number; emojiShare: number; topEmoji: string[]; words: string[]; burst: number; questionMark: number };

const KINDS: [string, string][] = [
  ["INTEREST", "Interests"], ["HOBBY", "Hobbies"], ["VALUE", "What you value"], ["HABIT", "Habits"], ["TEXTING", "How you text"],
  ["AFFECTION", "How you show care"], ["STRENGTH", "Strengths"], ["BLIND_SPOT", "Blind spots"], ["PATTERN", "Patterns"], ["FACT", "Facts"],
];
const LABEL = Object.fromEntries(KINDS);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The user's own profile: what every person's coach knows about them, and theirs to correct. */
export function SelfProfileView({ summary, traits, voice, people }: { summary: string | null; traits: Trait[]; voice: VoiceSummary | null; people: number }) {
  const grouped = KINDS.map(([k, label]) => ({ k, label, items: traits.filter((t) => t.kind === k) })).filter((g) => g.items.length);
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="display text-4xl">You</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            What Botmon has learned about you from your own side of your chats, and what you told the coach. Every person&apos;s coach uses this, so it doesn&apos;t have to learn you again for each one. It stays when you delete a person. Nothing here is about them.
          </p>
        </div>
        <Link href="/me/coach" className="btn-primary">Coach me</Link>
      </header>

      {summary && <p className="card p-6 leading-relaxed text-muted sm:p-8">{summary}</p>}

      {voice && (
        <section className="card p-6 sm:p-8">
          <h2 className="font-medium">How you text</h2>
          <p className="mt-1 text-xs text-dim">Measured from {voice.count.toLocaleString()} of your own messages{people > 1 ? ` across your chats` : ""}. Drafts for a person with no chat use this.</p>
          <ul className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <li>About {voice.medianWords} word{voice.medianWords === 1 ? "" : "s"} a message</li>
            <li>{pct(voice.lowerStart)} start lowercase</li>
            <li>{voice.emojiShare < 0.02 ? "Almost no emoji" : `Emoji in ${pct(voice.emojiShare)}${voice.topEmoji.length ? `, mostly ${voice.topEmoji.slice(0, 4).join(" ")}` : ""}`}</li>
            <li>{voice.burst >= 1.8 ? `Often ${Math.round(voice.burst)} messages in a row` : "Usually one message at a time"}</li>
            {voice.words.length > 0 && <li className="sm:col-span-2">Your words: {voice.words.join(", ")}</li>}
          </ul>
        </section>
      )}

      <section className="card p-6 sm:p-8">
        <h2 className="mb-4 font-medium">Add something about you</h2>
        <TraitForm />
      </section>

      {grouped.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">Nothing yet. It fills in as your chats are read and as you tell the coach about yourself.</p>
      ) : (
        grouped.map((g) => (
          <section key={g.k} className="space-y-2">
            <h2 className="display text-2xl">{g.label}</h2>
            <ul className="card divide-y divide-line">{g.items.map((t) => <TraitRow key={t.id} t={t} />)}</ul>
          </section>
        ))
      )}
    </div>
  );
}

function TraitRow({ t }: { t: Trait }) {
  const [editing, setEditing] = useState(false);
  const where = t.source === "USER" ? "you said so" : t.noEvidence ? "seen before; its chats are gone" : t.scope === "GLOBAL" ? `with ${t.people} people` : `with your ${(t.relation ?? "").toLowerCase()}`;
  return (
    <li className="flex flex-wrap items-start gap-3 px-6 py-4">
      {editing ? (
        <TraitForm trait={t} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{t.pinned && <span className="mr-1 text-amber" title="Pinned">●</span>}{t.text}</p>
            <p className="mt-1 text-xs text-dim">
              {where}
              {t.support > 0 && ` · ${t.support} time${t.support === 1 ? "" : "s"}`}
              {t.source !== "USER" && ` · ${t.confidence >= 0.7 ? "sure" : t.confidence >= 0.45 ? "fairly sure" : "a hint"}`}
              {t.edited && " · edited by you"}
            </p>
          </div>
          <button className="text-xs text-muted hover:text-paper" onClick={async () => { const r = await pinTrait(t.id, !t.pinned); if (r?.error) toast.error(r.error); }}>{t.pinned ? "Unpin" : "Pin"}</button>
          <button className="text-xs text-muted hover:text-paper" onClick={() => setEditing(true)}>Edit</button>
          <ConfirmButton
            className="text-xs text-muted hover:text-heart"
            action={() => trashItem("trait", t.id)}
            title="Hide this from your profile?"
            description="No coach will use it. It moves to the trash for 30 days, and reads won't bring it back."
            confirmLabel="Hide"
            onDone={() => void toast.success("Hidden")}
          >
            Hide
          </ConfirmButton>
        </>
      )}
    </li>
  );
}

function TraitForm({ trait, onDone }: { trait?: Trait; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTrait, undefined);
  useEffect(() => {
    if (state?.error) toast.error(state.error);
    if (state?.ok) {
      toast.success("Saved");
      onDone?.();
    }
  }, [state, onDone]);
  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2">
      {trait && <input type="hidden" name="id" value={trait.id} />}
      <select name="kind" aria-label="Kind" className="input h-10 w-auto" defaultValue={trait?.kind ?? "INTEREST"}>
        {KINDS.map(([k]) => <option key={k} value={k}>{LABEL[k]}</option>)}
      </select>
      <input name="text" aria-label="About you" className="input h-10 min-w-0 flex-1" required maxLength={200} defaultValue={trait?.text ?? ""} placeholder="Plays football on Sundays" />
      <button className="btn-primary h-10" disabled={pending}>{pending ? "Saving…" : trait ? "Save" : "Add"}</button>
      {trait && <button type="button" className="btn-ghost h-10" onClick={onDone}>Cancel</button>}
    </form>
  );
}
