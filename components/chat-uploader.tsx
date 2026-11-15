"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gzipSync, strToU8 } from "fflate";
import { toast } from "sonner";
import { parseFiles, parseWhatsApp, type ParsedChat } from "@/lib/parsers";
import { namesMatch, trimToNew } from "@/lib/merge";
import { removeChat } from "@/app/actions";

type Existing = { myName: string; theirName: string; lastAt: number } | null;
const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function ChatUploader({ personId, personName, existing }: { personId: string; personName: string; existing: Existing }) {
  const hasChat = !!existing;
  const [open, setOpen] = useState(!hasChat);
  const [chat, setChat] = useState<ParsedChat | null>(null);
  const [me, setMe] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Uncontrolled: a long chat pasted on a phone shouldn't re-render the page on every change.
  const box = useRef<HTMLTextAreaElement>(null);
  // The box unmounts while the "which one is you" step shows; this puts the text back when the user goes Back.
  const [kept, setKept] = useState("");
  const router = useRouter();

  // On a phone, pasting is the main way in: show the box without an extra tap. A ref callback, so it runs
  // each time the box appears (after "Add newer export", after Back), not only on first render.
  const openOnPhone = useCallback((el: HTMLDetailsElement | null) => {
    if (el && (kept || matchMedia("(hover: none)").matches)) el.open = true;
  }, [kept]);

  /** `pasted`: the text the chat was read from, when it came from the paste box. */
  function accept(c: ParsedChat, pasted?: string) {
    if (!c.messages.length)
      return toast.error(
        pasted === undefined
          ? "Couldn't find any messages in that file."
          : `Couldn't find WhatsApp messages in that text. It starts with: "${pasted.trim().slice(0, 60)}". Each message should start with a date and time.`,
        { duration: 10_000 },
      );
    setChat(c);
    // Same chat as before? Reuse who "me" was. Otherwise guess the sender whose name doesn't look like the person's.
    const guess =
      (existing && c.senders.includes(existing.myName) ? existing.myName : undefined) ??
      c.senders.find((s) => !s.toLowerCase().includes(personName.toLowerCase().split(" ")[0])) ?? c.senders[1] ?? c.senders[0];
    setMe(guess);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      accept(await parseFiles([...files]));
    } catch (e) {
      toast.error((e as Error).message || "Couldn't read that file");
    }
  }

  function readPasted() {
    const text = box.current?.value ?? "";
    if (!text.trim()) return toast.error("Paste your WhatsApp messages in the box first.");
    setKept(text);
    accept({ ...parseWhatsApp(text), source: "PASTE" }, text);
  }

  async function fromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (box.current && text) box.current.value = text;
    } catch {
      // No clipboard access (older browser, permission denied): paste by hand.
      toast.info("Press and hold in the box, then tap Paste.");
    }
    box.current?.focus();
  }

  async function upload() {
    if (!chat || !me) return;
    // Group chats: keep only you and the most active other person.
    const theirName = chat.senders.find((s) => s !== me);
    if (!theirName) return toast.error(`This chat only has messages from ${me}. Export a chat with both of you in it.`);
    const pair = chat.messages.filter((m) => m.sender === me || m.sender === theirName);
    const sameChat = existing?.myName === me && existing?.theirName === theirName;
    if (!sameChat && pair.length < 10) return toast.error(`Only ${pair.length} messages between you and ${theirName}. Need at least 10.`);
    // Re-export of a chat we already have: only send what can be new (plus a day of overlap for exact de-dupe).
    const messages = sameChat ? trimToNew(pair, existing.lastAt) : pair;
    if (sameChat && !messages.length) return toast.info(`Nothing new. You already have everything up to ${fmt(existing.lastAt)}.`);
    setBusy(true);
    try {
      const body = gzipSync(strToU8(JSON.stringify({ source: chat.source, myName: me, theirName, messages, tzOffset: new Date().getTimezoneOffset() })));
      const res = await fetch(`/api/people/${personId}/chat`, { method: "POST", body, headers: { "content-type": "application/octet-stream" } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (json.mode !== "merged")
        toast.success(`${json.msgCount.toLocaleString()} messages with ${theirName} saved to ${personName}`, {
          duration: 12_000,
          action: {
            label: "Undo",
            onClick: async () => {
              const r = await removeChat(json.id).catch(() => ({ error: "Couldn't undo. Use “Wrong chat?” on this page." }));
              if (r?.error) toast.error(r.error);
              else toast.success(json.mode === "replaced" ? "Undone. Your previous chat is back." : "Undone. Chat removed.");
            },
          },
        });
      else if (json.added) toast.success(`Added ${json.added.toLocaleString()} new messages (${fmt(json.from)} – ${fmt(json.to)}). Older ones were already saved.`);
      else toast.info(`Nothing new. You already have everything up to ${fmt(existing!.lastAt)}.`);
      setChat(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const them = chat?.senders.find((s) => s !== me);
  const replaces = existing && them && (existing.myName !== me || existing.theirName !== them) ? existing.theirName : null;

  if (!open)
    return <button className="btn-ghost h-9 px-4" onClick={() => setOpen(true)}>Add newer export</button>;

  return (
    <section className="card p-6 sm:p-8">
      <h2 className="display text-2xl">{hasChat ? "Add a newer export" : "Add your chat"}</h2>
      {existing && (
        <p className="mt-2 text-sm text-muted">
          You have messages up to <strong className="text-paper">{fmt(existing.lastAt)}</strong>. Drop a fresh export of the same chat and only newer messages get added. A chat with different people replaces it.
        </p>
      )}

      {!chat ? (
        <>
          <details className="mt-3 text-sm text-muted">
            <summary className="cursor-pointer text-paper/80 hover:text-paper">How do I export?</summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p><strong className="text-paper">WhatsApp:</strong> open the chat → ⋮ / contact name → More → Export chat → Without media. Upload the .txt or .zip.</p>
              <p><strong className="text-paper">Instagram:</strong> Accounts Center → Your information → Download your information → Messages, format <em>JSON</em>. Upload the <code>message_1.json</code> files from that person&apos;s folder (or the folder zipped).</p>
            </div>
          </details>

          <div
            role="button" tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
            className={`mt-5 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? "border-heart bg-heart/5" : "border-line hover:border-muted"}`}
          >
            <p className="font-medium">Tap or drop your export here</p>
            <p className="mt-1 text-sm text-dim">.txt, .zip or .json · read in your browser first</p>
          </div>
          <input ref={input} type="file" accept=".txt,.zip,.json,text/plain,application/zip,application/json" multiple hidden onChange={(e) => onFiles(e.target.files)} />

          <details ref={openOnPhone} className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted hover:text-paper">Or paste WhatsApp text</summary>
            <p className="mt-3 text-muted">Select messages in the WhatsApp chat and tap Copy, or copy the text of an exported chat. Both work.</p>
            <label className="sr-only" htmlFor="paste-box">WhatsApp text</label>
            {/* 16px on phones: smaller text makes iOS zoom the page when the box is focused. */}
            <textarea
              id="paste-box" ref={box} rows={6} defaultValue={kept} autoCapitalize="off" autoCorrect="off" spellCheck={false}
              className="input mt-3 h-auto py-3 font-mono text-base sm:text-xs"
              placeholder={"[14/11, 9:41 pm] Riya: hey\n14/11/26, 9:42 pm - You: hi"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost h-11 px-4 sm:h-9" onClick={fromClipboard}>Paste from clipboard</button>
              <button type="button" className="btn-primary h-11 px-4 sm:h-9" onClick={readPasted}>Use pasted text</button>
            </div>
          </details>
        </>
      ) : (
        <div className="mt-5 space-y-5">
          <p className="text-sm text-muted">
            Found <strong className="text-paper">{chat.messages.length.toLocaleString()}</strong> messages from{" "}
            {new Date(chat.messages[0].ts).toLocaleDateString()} to {new Date(chat.messages.at(-1)!.ts).toLocaleDateString()}.
          </p>
          <fieldset>
            <legend className="label">Which one is you?</legend>
            <div className="flex flex-wrap gap-2">
              {chat.senders.slice(0, 8).map((s) => (
                <button key={s} type="button" onClick={() => setMe(s)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${me === s ? "border-heart bg-heart text-ink" : "border-line hover:bg-ink-3"}`}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          {them && (
            <div className="space-y-2 text-sm">
              <p className="text-muted">Chat between <strong className="text-paper">{me}</strong> and <strong className="text-paper">{them}</strong>, saving to <strong className="text-paper">{personName}</strong>.</p>
              {!namesMatch(personName, them) && (
                <p role="alert" className="rounded-xl border border-amber/40 bg-amber/5 px-4 py-3 text-amber">
                  This page is for {personName}, but this chat is with {them}. Wrong person? If it&apos;s the same person under another name, carry on.
                </p>
              )}
              {replaces && <p className="text-muted">This replaces the current chat with {replaces}. That one goes to Trash, and comes back if you undo.</p>}
            </div>
          )}
          <label className="flex items-start gap-3 text-sm text-muted">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--heart)]" />
            I&apos;m part of this conversation and I&apos;ll keep what I learn here private.
          </label>
          <div className="flex gap-3">
            <button className="btn-primary" disabled={!consent || !me || busy} onClick={upload}>{busy ? "Encrypting…" : "Save chat"}</button>
            <button className="btn-ghost" onClick={() => setChat(null)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
