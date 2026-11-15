"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { renameThread, trashItem } from "@/app/actions";
import { syncModel, type ModelSync } from "@/lib/model-sync";
import { chatHeight } from "@/lib/chat-height";
import { ConfirmButton } from "./confirm-button";

type Thread = { id: string; title: string; updatedAt: string };

const starters = (name: string) => [
  `${name} hasn't replied since yesterday. What should I do?`,
  "We had a small fight today. How do I make it right?",
  "What should I plan for our next date?",
  `What does ${name} really want from me right now?`,
];

function errorText(e: Error) {
  try {
    return JSON.parse(e.message).error as string;
  } catch {
    return e.message || "Something went wrong";
  }
}

export function CoachChat({ personId, personName, threadId, initialMessages, threads, canChat }: {
  personId: string; personName: string; threadId: string | null; initialMessages: UIMessage[]; threads: Thread[]; canChat: boolean;
}) {
  const [current, setCurrent] = useState(threadId);
  const [list, setList] = useState(threads);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Rename is finished (saved or cancelled); stops the unmount blur from submitting again.
  const renameSettled = useRef(false);
  const startRename = (id: string) => {
    renameSettled.current = false;
    setRenaming(id);
  };
  const lastSent = useRef("");
  const [input, setInput] = useState("");
  const base = `/people/${personId}/coach`;

  // Created once; the thread id travels per message via sendMessage's body.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: `/api/people/${personId}/coach`,
        prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, message: messages.at(-1) } }),
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const id = res.headers.get("x-thread-id");
          if (id) {
            setCurrent(id);
            // New conversation: show it in the list right away (no page refresh, which would remount mid-save).
            setList((l) => (l.some((t) => t.id === id) ? l : [{ id, title: lastSent.current.slice(0, 60), updatedAt: new Date().toISOString() }, ...l]));
            window.history.replaceState(null, "", `${base}?t=${id}`); // keep the URL in sync without remounting
          }
          return res;
        },
      }),
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    id: threadId ?? undefined,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(errorText(e)),
    // The coach saved or corrected a memory: bring the read up to date in the background, no re-read.
    onFinish: async ({ message }) => {
      if (!changedMemory(message)) return;
      setProfile({ status: "running" });
      setProfile(await syncModel(personId));
    },
  });
  const [profile, setProfile] = useState<ModelSync | { status: "running" } | null>(null);

  const busy = status === "submitted" || status === "streaming";

  // The card is sized to the screen so only the message list scrolls, never the page.
  const wrap = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const card = useRef<HTMLElement>(null);
  const [showThreads, setShowThreads] = useState(false);
  useEffect(() => {
    const fit = () => {
      if (!wrap.current || !card.current) return;
      // visualViewport shrinks when a phone keyboard opens, keeping the message box on screen.
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      wrap.current.style.setProperty("--chat-h", `${chatHeight(viewport, card.current.getBoundingClientRect().top + window.scrollY)}px`);
    };
    fit();
    // Anything above the card changing height moves it: the conversation list on phones, the person's name
    // wrapping after a rename, a font loading. The body covers all of them.
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    if (side.current) ro.observe(side.current);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  // Follow new messages, unless the user scrolled up to read older ones.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, profile]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    lastSent.current = t;
    stick.current = true;
    sendMessage({ text: t }, { body: { threadId: current } });
    setInput("");
  }

  return (
    <div ref={wrap} className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-6">
      <aside ref={side} className="space-y-2 lg:max-h-[var(--chat-h,70dvh)] lg:overflow-y-auto lg:overscroll-contain">
        <div className="flex gap-2">
          <Link href={base} className="btn-ghost h-9 flex-1">+ New conversation</Link>
          {list.length > 0 && (
            <button type="button" className="btn-ghost h-9 px-4 lg:hidden" aria-expanded={showThreads} aria-controls="coach-threads" onClick={() => setShowThreads((v) => !v)}>
              Conversations ({list.length})
            </button>
          )}
        </div>
        <ul id="coach-threads" className={`space-y-1 lg:block ${showThreads ? "" : "hidden"}`}>
          {list.map((t) => (
            <li key={t.id} className="group flex items-center gap-1">
              {renaming === t.id ? (
                <form
                  className="min-w-0 flex-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (renameSettled.current) return;
                    renameSettled.current = true;
                    const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
                    setRenaming(null);
                    if (!title || title === t.title) return;
                    const r = await renameThread(t.id, title);
                    if (r?.error) toast.error(r.error);
                    else setList((l) => l.map((x) => (x.id === t.id ? { ...x, title: title.slice(0, 80) } : x)));
                  }}
                >
                  <input
                    name="title" defaultValue={t.title} maxLength={80} autoFocus aria-label="Conversation name"
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return;
                      renameSettled.current = true; // cancel: the blur from unmounting must not save
                      setRenaming(null);
                    }}
                    onBlur={(e) => !renameSettled.current && e.currentTarget.form?.requestSubmit()}
                    className="input h-9 px-3"
                  />
                </form>
              ) : (
                <Link
                  href={`${base}?t=${t.id}`}
                  className={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm transition ${t.id === current ? "bg-ink-3 text-paper" : "text-muted hover:bg-ink-2 hover:text-paper"}`}
                >
                  {t.title}
                </Link>
              )}
              <button
                aria-label={`Rename ${t.title}`} className="px-1 text-xs text-dim hover:text-paper sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                onClick={() => startRename(t.id)}
              >
                ✎
              </button>
              <ConfirmButton
                ariaLabel={`Delete ${t.title}`}
                className="px-1 text-xs text-dim hover:text-heart sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                action={() => trashItem("thread", t.id)}
                title="Delete this conversation?"
                description={<>&ldquo;{t.title}&rdquo; moves to the trash; restore it from Trash within 30 days. Facts it saved to the timeline stay.</>}
                confirmLabel="Move to trash"
                onDone={() => {
                  toast.success("Conversation moved to trash");
                  setList((l) => l.filter((x) => x.id !== t.id));
                  if (t.id === current) {
                    // Deleted the open conversation: start fresh so the next message can't go to a trashed thread.
                    stop();
                    setCurrent(null);
                    setMessages([]);
                    window.history.replaceState(null, "", base);
                  }
                }}
              >
                ✕
              </ConfirmButton>
            </li>
          ))}
        </ul>
      </aside>

      <section ref={card} className="card flex h-[var(--chat-h,70dvh)] flex-col overflow-hidden">
        <div
          ref={scroller}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6" aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {messages.length === 0 && (
            <div className="grid h-full place-items-center py-10 text-center">
              <div>
                <p className="display text-2xl">Talk it through.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                  Tell me what happened with {personName}. I remember what you tell me and keep their read up to date, with or without a chat.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {starters(personName.split(" ")[0]).map((s) => (
                    <button key={s} className="chip hover:border-heart/50 hover:text-paper" disabled={!canChat} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((m) => <Message key={m.id} m={m} />)}
          {status === "submitted" && <p className="text-sm text-dim">Thinking…</p>}
          {profile && profile.status !== "current" && (
            <p className="text-xs text-dim" aria-live="polite">
              {profile.status === "running" ? (
                <span className="animate-pulse">Updating {personName}&apos;s read with this…</span>
              ) : profile.status === "failed" ? (
                <>Couldn&apos;t update the read{profile.error ? `: ${profile.error}` : ""}. It will catch up when you open it.</>
              ) : (
                <>
                  <span className="text-mint">{profile.status === "created" ? "Read created from what you've told me." : "Read updated."}</span>{" "}
                  {profile.whatChanged} <Link href={`/people/${personId}`} className="text-heart underline-offset-4 hover:underline">Open the read</Link>
                </>
              )}
            </p>
          )}
          {error && !busy && <p className="text-sm text-heart">{errorText(error)}</p>}
        </div>

        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={canChat ? `What happened with ${personName}?` : "Add an AI key in Settings to chat"}
            disabled={!canChat}
            aria-label="Message"
            className="input h-auto min-h-11 flex-1 resize-none py-3"
          />
          {busy ? (
            <button type="button" className="btn-ghost" onClick={stop}>Stop</button>
          ) : (
            <button className="btn-primary" disabled={!canChat || !input.trim()}>Send</button>
          )}
        </form>
      </section>
    </div>
  );
}

/** Did this assistant turn save or correct a memory? */
function changedMemory(m: UIMessage) {
  return m.parts.some((p) => {
    if (!("state" in p) || p.state !== "output-available") return false;
    const out = p.output as { saved?: boolean; updated?: boolean } | undefined;
    return (p.type === "tool-remember" && !!out?.saved) || (p.type === "tool-correct" && !!out?.updated);
  });
}

function Message({ m }: { m: UIMessage }) {
  const mine = m.role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex"}>
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed ${mine ? "rounded-br-md bg-heart text-ink" : "rounded-bl-md bg-ink-3"}`}>
        {m.parts.map((p, i) => {
          if (p.type === "text") return <p key={i} className="whitespace-pre-wrap">{p.text}</p>;
          if (p.type === "tool-remember" && p.state === "output-available") {
            const out = p.output as { saved?: boolean; text?: string };
            return out?.saved ? <p key={i} className="chip border-mint/40 text-mint">Saved to timeline: {out.text}</p> : null;
          }
          if (p.type === "tool-correct" && p.state === "output-available") {
            const out = p.output as { updated?: boolean; retired?: string; saved?: string };
            return out?.updated ? <p key={i} className="chip border-amber/40 text-amber">Memory corrected: {out.saved ?? `removed “${out.retired}”`}</p> : null;
          }
          if (p.type === "tool-recall" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Checking what I remember…</p>;
          if (p.type === "tool-searchChat" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Looking through your chat…</p>;
          return null;
        })}
      </div>
    </div>
  );
}
