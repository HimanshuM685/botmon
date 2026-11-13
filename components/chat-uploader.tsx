"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gzipSync, strToU8 } from "fflate";
import { toast } from "sonner";
import { parseFiles, parseWhatsApp, type ParsedChat } from "@/lib/parsers";

export function ChatUploader({ personId, personName, hasChat }: { personId: string; personName: string; hasChat: boolean }) {
  const [open, setOpen] = useState(!hasChat);
  const [chat, setChat] = useState<ParsedChat | null>(null);
  const [me, setMe] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function accept(c: ParsedChat) {
    if (c.messages.length < 10) return toast.error("Couldn't find enough messages in that file.");
    setChat(c);
    // Guess "me" as the sender whose name doesn't look like the person's name.
    const guess = c.senders.find((s) => !s.toLowerCase().includes(personName.toLowerCase().split(" ")[0])) ?? c.senders[1] ?? c.senders[0];
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

  async function upload() {
    if (!chat || !me) return;
    // Group chats: keep only you and the most active other person.
    const theirName = chat.senders.find((s) => s !== me);
    if (!theirName) return toast.error(`This chat only has messages from ${me}. Export a chat with both of you in it.`);
    const messages = chat.messages.filter((m) => m.sender === me || m.sender === theirName);
    if (messages.length < 10) return toast.error(`Only ${messages.length} messages between you and ${theirName}. Need at least 10.`);
    setBusy(true);
    try {
      const body = gzipSync(strToU8(JSON.stringify({ source: chat.source, myName: me, theirName, messages, tzOffset: new Date().getTimezoneOffset() })));
      const res = await fetch(`/api/people/${personId}/chat`, { method: "POST", body, headers: { "content-type": "application/octet-stream" } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(`${json.msgCount.toLocaleString()} messages saved`);
      setChat(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return <button className="btn-ghost h-9 px-4" onClick={() => setOpen(true)}>Replace chat</button>;

  return (
    <section className="card p-6 sm:p-8">
      <h2 className="display text-2xl">{hasChat ? "Replace chat" : "Add your chat"}</h2>

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
            <p className="font-medium">Drop your export here</p>
            <p className="mt-1 text-sm text-dim">.txt, .zip or .json · read in your browser first</p>
          </div>
          <input ref={input} type="file" accept=".txt,.zip,.json" multiple hidden onChange={(e) => onFiles(e.target.files)} />

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted hover:text-paper">Or paste WhatsApp text</summary>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} className="input mt-3 h-auto py-3 font-mono text-xs" placeholder="31/12/23, 9:41 pm - Riya: hey" />
            <button type="button" className="btn-ghost mt-3 h-9 px-4" disabled={!paste.trim()} onClick={() => accept({ ...parseWhatsApp(paste), source: "PASTE" })}>Use pasted text</button>
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
