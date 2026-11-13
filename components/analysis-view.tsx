"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useObject } from "@ai-sdk/react";
import type { DeepPartial } from "ai";
import { toast } from "sonner";
import { analysisSchema, type Analysis } from "@/lib/ai/schema";

type Saved = { id: string; createdAt: string; model: string; mode: string; result: Analysis };
/** "none": no read yet; "update": new messages since the last read; "current": nothing new; "changed": chat replaced since. */
export type ReadState = "none" | "update" | "current" | "changed";

function errorText(e: Error) {
  try {
    return JSON.parse(e.message).error as string;
  } catch {
    return e.message || "Analysis failed";
  }
}

export function AnalysisView({ personId, history, canRun, state }: { personId: string; history: Saved[]; canRun: boolean; state: ReadState }) {
  const router = useRouter();
  // null = follow the newest saved analysis
  const [selected, setSelected] = useState<string | null>(null);
  // Newest history id when the current run started; the live object is shown until a newer one arrives via refresh.
  const [baseline, setBaseline] = useState<string | undefined | null>(null);
  const { object, submit, isLoading, stop, clear } = useObject({
    api: `/api/people/${personId}/analyze`,
    schema: analysisSchema,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      const n = Number(res.headers.get("x-read-messages") ?? 0);
      if (res.ok && res.headers.get("x-read-mode") === "incremental")
        toast.info(`Updating your last read with ${n.toLocaleString()} new message${n === 1 ? "" : "s"} only.`);
      return res;
    },
    onError: (e) => {
      toast.error(errorText(e));
      clear();
    },
    onFinish: ({ error }) => {
      if (error) {
        toast.error("The model returned an incomplete answer. Try again or switch model in Settings.");
        clear();
        setBaseline(null);
      } else router.refresh();
    },
  });

  function run(mode: "auto" | "full") {
    setSelected(null);
    setBaseline(history[0]?.id);
    submit({ mode });
  }

  const latest = history[0];
  const waitingForRefresh = object && baseline !== null && latest?.id === baseline;
  const shown: DeepPartial<Analysis> | undefined =
    isLoading || waitingForRefresh ? object : (selected ? history.find((h) => h.id === selected) : latest)?.result;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display mr-auto text-3xl">The read</h2>
        {history.length > 1 && !isLoading && (
          <select aria-label="Past analyses" className="input h-9 w-auto" value={selected ?? latest?.id} onChange={(e) => setSelected(e.target.value === latest?.id ? null : e.target.value)}>
            {history.map((h) => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()}{h.mode === "incremental" ? " · update" : ""}</option>)}
          </select>
        )}
        {isLoading ? (
          <button className="btn-ghost" onClick={stop}>Stop</button>
        ) : (
          <>
            {state !== "none" && (
              <button className="text-sm text-muted underline-offset-4 hover:text-paper hover:underline disabled:opacity-50" disabled={!canRun} onClick={() => run("full")}>
                Full re-read
              </button>
            )}
            <button className="btn-primary" disabled={!canRun || state === "current"} onClick={() => run("auto")}>
              {state === "update" ? "Update with new messages" : state === "current" ? "Up to date" : "Analyze chat"}
            </button>
          </>
        )}
      </div>

      {!shown && !isLoading && (
        <div className="card grid place-items-center px-6 py-16 text-center text-muted">
          {canRun ? "Hit analyze. It takes 20–60 seconds depending on chat size." : "Upload a chat to get started."}
        </div>
      )}
      {isLoading && !object?.status && <div className="card h-48 animate-pulse" aria-busy />}
      {shown && <Report a={shown} live={isLoading} />}
    </section>
  );
}

function Report({ a, live }: { a: DeepPartial<Analysis>; live: boolean }) {
  const score = Math.round(a.status?.score ?? 0);
  return (
    <div className="space-y-4" aria-live="polite">
      {a.status && (
        <div className="card flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <ScoreRing score={score} />
          <div className="min-w-0">
            <p className="display text-3xl italic">{a.status.label}</p>
            <p className="mt-3 leading-relaxed text-muted">{a.status.explanation}</p>
          </div>
        </div>
      )}

      {a.nextMoves?.length ? (
        <Block title="Next moves" tone="mint">
          <ol className="space-y-4">
            {a.nextMoves.map((m, i) => m?.action && (
              <li key={i} className="flex gap-4">
                <span className="display text-2xl text-mint">{i + 1}</span>
                <div>
                  <p className="font-medium">{m.action}</p>
                  {m.why && <p className="mt-1 text-sm text-muted">{m.why}</p>}
                  {m.when && <p className="chip mt-2">{m.when}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {a.messageSuggestions?.length ? (
        <Block title="Things you could send" tone="heart">
          <ul className="space-y-2">
            {a.messageSuggestions.map((s, i) => s && (
              <li key={i} className="flex items-start justify-between gap-3 rounded-2xl rounded-br-md bg-heart/10 px-4 py-3">
                <span className="text-sm">{s}</span>
                {!live && (
                  <button className="shrink-0 text-xs text-heart hover:underline" onClick={() => navigator.clipboard.writeText(s).then(() => toast.success("Copied"))}>Copy</button>
                )}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {a.communicationStyle && (
        <Block title="How they text"><p className="leading-relaxed text-muted">{a.communicationStyle}</p></Block>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <List title="They love" items={a.likes} dot="bg-heart" />
        <List title="They don't like" items={a.dislikes} dot="bg-dim" />
        <List title="Green flags" items={a.greenFlags} dot="bg-mint" />
        <List title="Red flags" items={a.redFlags} dot="bg-amber" empty="None spotted." />
        <List title="Keep in mind" items={a.thingsToCareAbout} dot="bg-paper" />
        <List title="Avoid" items={a.avoid} dot="bg-heart-2" />
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const c = 2 * Math.PI * 42;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`Score ${score} of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--heart)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <span className="display absolute inset-0 grid place-items-center text-4xl">{score}</span>
    </div>
  );
}

function Block({ title, tone, children }: { title: string; tone?: "mint" | "heart"; children: React.ReactNode }) {
  const color = tone === "mint" ? "text-mint" : tone === "heart" ? "text-heart" : "text-muted";
  return (
    <div className="card p-6 sm:p-8">
      <h3 className={`label mb-4 ${color}`}>{title}</h3>
      {children}
    </div>
  );
}

function List({ title, items, dot, empty }: { title: string; items?: (string | undefined)[]; dot: string; empty?: string }) {
  if (!items?.length && !empty) return null;
  return (
    <Block title={title}>
      {items?.length ? (
        <ul className="space-y-2.5">
          {items.map((t, i) => t && (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${dot}`} />
              {t}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-dim">{empty}</p>}
    </Block>
  );
}
