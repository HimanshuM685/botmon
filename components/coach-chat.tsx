"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { renameThread, trashItem } from "@/app/actions";

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
  const router = useRouter();
  const [current, setCurrent] = useState(threadId);
  const [list, setList] = useState(threads);
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

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId ?? undefined,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(errorText(e)),

  });

  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    lastSent.current = t;
    sendMessage({ text: t }, { body: { threadId: current } });
    setInput("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-2">
        <Link href={base} className="btn-ghost h-9 w-full">+ New conversation</Link>
        <ul className="space-y-1">
          {list.map((t) => (
            <li key={t.id} className="group flex items-center gap-1">
              <Link
                href={`${base}?t=${t.id}`}
                className={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm transition ${t.id === current ? "bg-ink-3 text-paper" : "text-muted hover:bg-ink-2 hover:text-paper"}`}
              >
                {t.title}
              </Link>
              <button
                aria-label={`Rename ${t.title}`} className="hidden px-1 text-xs text-dim hover:text-paper group-hover:block"
                onClick={async () => {
                  const title = window.prompt("Rename conversation", t.title);
                  if (!title) return;
                  const r = await renameThread(t.id, title);
                  if (r?.error) toast.error(r.error);
                  else setList((l) => l.map((x) => (x.id === t.id ? { ...x, title: title.trim().slice(0, 80) } : x)));
                }}
              >
                ✎
              </button>
              <button
                aria-label={`Delete ${t.title}`} className="hidden px-1 text-xs text-dim hover:text-heart group-hover:block"
                onClick={async () => {
                  const r = await trashItem("thread", t.id);
                  if (r?.error) return toast.error(r.error);
                  toast.success("Moved to trash. Restore it from Trash within 30 days.");
                  router.push(base);
                  router.refresh();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card flex min-h-[60vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="grid h-full place-items-center py-10 text-center">
              <div>
                <p className="display text-2xl">Talk it through.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                  Tell me what happened with {personName}. I know your chat, the read and everything on the timeline.
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
          if (p.type === "tool-searchChat" && p.state !== "output-available") return <p key={i} className="text-xs text-dim">Looking through your chat…</p>;
          return null;
        })}
      </div>
    </div>
  );
}
