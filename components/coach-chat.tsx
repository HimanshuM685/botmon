"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { loadTrace, renameThread, trashItem } from "@/app/actions";
import { syncModel, type ModelSync } from "@/lib/model-sync";
import { chatHeight } from "@/lib/chat-height";
import { REHEARSAL_BANNER } from "@/lib/ai/persona";
import { ConfirmButton } from "./confirm-button";

type Thread = { id: string; title: string; updatedAt: string };

const practiceStarters = (name: string) => [
  "hey, free this weekend?",
  "i'm sorry about the other day",
  `${name}, can we talk about something?`,
];

const selfStarters = () => [
  "What are my blind spots in relationships?",
  "What do I usually bring to a conversation?",
  "How do I come across over text?",
];

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

export function CoachChat({ personId, personName, threadId, initialMessages, threads, canChat, mode = "coach", notice, debriefOf, improve }: {
  personId: string; personName: string; threadId: string | null; initialMessages: UIMessage[]; threads: Thread[]; canChat: boolean;
  /** "rehearsal": the user practises with a simulation of the person (app/api/people/[id]/rehearse). */
  mode?: "coach" | "rehearsal" | "self";
  /** A line shown under the rehearsal banner (their style is guessed; not enough is known). */
  notice?: string;
  /** A rehearsal thread to debrief: a new coach conversation starts with its transcript. */
  debriefOf?: string;
  /** Opened from "Improve this" on the read: a new conversation about raising one score, and its first message. */
  improve?: { signal: string; ask: string };
}) {
  const rehearsal = mode === "rehearsal";
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
  // "Coach me" threads are the user's own, on /me, with no person.
  const self = mode === "self";
  const base = self ? "/me/coach" : `/people/${personId}/${rehearsal ? "rehearse" : "coach"}`;

  // Created once; the thread id travels per message via sendMessage's body.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: self ? "/api/me/coach" : `/api/people/${personId}/${rehearsal ? "rehearse" : "coach"}`,
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

  function send(text: string, extra?: { debriefOf: string } | { improve: string }) {
    const t = text.trim();
    if (!t || busy) return;
    lastSent.current = t;
    stick.current = true;
    sendMessage({ text: t }, { body: { threadId: current, ...extra } });
    setInput("");
  }

  // Opened from a rehearsal's "How did I do?" or a score's "Improve this": ask once, straight away. The ref survives a dev double-mount.
  const debriefed = useRef(false);
  useEffect(() => {
    const first = debriefOf ? { text: "How did I do?", extra: { debriefOf } } : improve ? { text: improve.ask, extra: { improve: improve.signal } } : null;
    if (!first || debriefed.current || !canChat) return;
    debriefed.current = true;
    send(first.text, first.extra);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  return (
    <div ref={wrap} className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-6">
      <aside ref={side} className="space-y-2 lg:max-h-[var(--chat-h,70dvh)] lg:overflow-y-auto lg:overscroll-contain">
        <div className="flex gap-2">
          <Link href={base} className="btn-ghost h-9 flex-1">{rehearsal ? "+ New practice" : "+ New conversation"}</Link>
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
        {rehearsal && (
          // Always on screen: not inside the scrolling list.
          <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber/40 bg-amber/10 px-5 py-2 text-xs text-amber">
            <span className="font-semibold">{REHEARSAL_BANNER(personName)}</span>
            {notice && <span className="text-muted">{notice}</span>}
            {current && messages.length >= 2 && !busy && (
              <Link href={`/people/${personId}/coach?debrief=${current}`} className="ml-auto text-heart underline-offset-4 hover:underline">How did I do?</Link>
            )}
          </div>
        )}
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
                <p className="display text-2xl">{rehearsal ? "Try it here first." : self ? "About you." : "Talk it through."}</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                  {self
                    ? "Talk about yourself: your patterns, what you're like over text, what you care about. What you tell me here goes to your profile, which every person's coach uses."
                    : rehearsal
                    ? `Type what you'd send ${personName}. The replies are a simulation built from their real messages and what is known about them. Nothing you practise here is remembered as something they said.`
                    : `Tell me what happened with ${personName}. I remember what you tell me and keep their read up to date, with or without a chat.`}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {(self ? selfStarters : rehearsal ? practiceStarters : starters)(personName.split(" ")[0]).map((s) => (
                    <button key={s} className="chip hover:border-heart/50 hover:text-paper" disabled={!canChat} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((m) => <Message key={m.id} m={m} persona={rehearsal ? personName : undefined} />)}
          {status === "submitted" && <p className="text-sm text-dim">{rehearsal ? `Simulated ${personName} is typing…` : "Thinking…"}</p>}
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
            placeholder={!canChat ? (notice && rehearsal ? "Not enough to practise with yet" : "Add an AI key in Settings to chat") : rehearsal ? `Say it the way you'd text ${personName}` : self ? "Ask about yourself, or tell me something about you" : `What happened with ${personName}?`}
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

function Message({ m, persona }: { m: UIMessage; /** Set in a rehearsal: replies are a simulation of this person. */ persona?: string }) {
  const mine = m.role === "user";
  const simulated = !!persona && !mine;
  return (
    <div className={mine ? "flex justify-end" : "flex"}>
      {/* A simulated reply never looks like the coach's: dashed amber outline and a label. */}
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed ${mine ? "rounded-br-md bg-heart text-ink" : simulated ? "rounded-bl-md border border-dashed border-amber/60 bg-ink-2" : "rounded-bl-md bg-ink-3"}`}>
        {simulated && <p className="text-[10px] uppercase tracking-wide text-amber">Simulated {persona.split(" ")[0]}</p>}
        {m.parts.map((p, i) => {
          if (p.type === "text")
            return mine ? <p key={i} className="whitespace-pre-wrap">{p.text}</p> : (
              // Replies are Markdown; raw HTML in them is shown as text, never run.
              <div key={i} className="md">
                <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a> }}>{p.text}</Markdown>
              </div>
            );
          if (p.type === "tool-remember" && p.state === "output-available") {
            const out = p.output as { saved?: boolean; text?: string };
            return out?.saved ? <p key={i} className="chip border-mint/40 text-mint">Saved to timeline: {out.text}</p> : null;
          }
          if (p.type === "tool-rememberMe" && p.state === "output-available") {
            const out = p.output as { saved?: boolean; text?: string };
            return out?.saved ? <p key={i} className="chip border-heart/40 text-heart">Saved to your profile: {out.text}</p> : null;
          }
          if (p.type === "tool-correct" && p.state === "output-available") {
            const out = p.output as { updated?: boolean; retired?: string; saved?: string };
            return out?.updated ? <p key={i} className="chip border-amber/40 text-amber">Memory corrected: {out.saved ?? `removed “${out.retired}”`}</p> : null;
          }
          if (p.type === "tool-recall" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Checking what I remember…</p>;
          if (p.type === "tool-connect" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Following how things connect…</p>;
          if (p.type === "tool-searchChat" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Looking through your chat…</p>;
          if (p.type === "tool-quote" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Reading what was actually said…</p>;
          if (p.type === "tool-search_history" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Looking through what we said before…</p>;
          if (p.type === "tool-check_draft" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Checking the message…</p>;
          return null;
        })}
        {!mine && !persona && m.parts.some((p) => p.type === "text") && <Why id={m.id} />}
      </div>
    </div>
  );
}

type Trace = {
  provider?: string; model?: string; steps?: number; focus?: string[]; edges?: number; memories?: number;
  findings?: { kind: string; isNew?: boolean }[]; tools?: { name: string; chars: number }[];
  history?: { messages: number; summarised: boolean }; chars?: { context: number; budget: number };
};

/** What this reply was built from: loaded when opened, so nothing extra travels with every message. */
function Why({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace | null | "loading">(null);
  const toggle = async () => {
    setOpen((v) => !v);
    if (trace) return;
    setTrace("loading");
    setTrace(((await loadTrace(id).catch(() => null)) as Trace | null) ?? {});
  };
  const t = trace && trace !== "loading" ? trace : null;
  return (
    <div className="text-xs text-dim">
      <button type="button" className="underline-offset-4 hover:text-paper hover:underline" aria-expanded={open} onClick={toggle}>why?</button>
      {open && (
        trace === "loading" ? <p className="mt-1">Loading…</p> : !t?.model ? <p className="mt-1">No details were kept for this reply.</p> : (
          <ul className="mt-1 space-y-0.5">
            <li>About: {t.focus?.length ? t.focus.join(", ") : "nothing named in memory"}</li>
            <li>From memory: {t.memories ?? 0} memories, {t.edges ?? 0} links{t.findings?.length ? `, findings: ${t.findings.map((f) => `${f.kind.replace("_", " ")}${f.isNew ? " (new)" : ""}`).join(", ")}` : ""}</li>
            <li>Looked up: {t.tools?.length ? t.tools.map((x) => `${x.name.replace("_", " ")} (${x.chars} chars)`).join(", ") : "nothing more"}, in {t.steps} step{t.steps === 1 ? "" : "s"}</li>
            <li>Conversation: {t.history?.messages ?? 0} messages{t.history?.summarised ? " plus a summary of the earlier part" : ""}</li>
            <li>{t.provider} {t.model}; context {t.chars?.context.toLocaleString()} of {t.chars?.budget.toLocaleString()} chars</li>
          </ul>
        )
      )}
    </div>
  );
}
