"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useObject } from "@ai-sdk/react";
import type { DeepPartial } from "ai";
import { toast } from "sonner";
import { analysisSchema, modelPatchSchema, type Analysis, type ModelPatch } from "@/lib/ai/schema";
import { trashItem } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

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

type AdviceStatus = { state: "idle" | "updating" | "failed"; at?: string; refresh: () => void };

/** Lay a streaming model update over the saved read: sections the update left null keep their saved value. */
function overlay(saved: DeepPartial<Analysis> | undefined, patch: DeepPartial<ModelPatch>): DeepPartial<Analysis> {
  const out: Record<string, unknown> = { ...saved };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    out[k] = k === "status" ? { ...saved?.status, ...(v as object) } : v; // keep the score until the server recomputes it
  }
  return out as DeepPartial<Analysis>;
}

export function AnalysisView({ personId, history, hasChat, canRun, canSync, state, advice }: {
  personId: string;
  hasChat: boolean;
  history: Saved[];
  /** A chat and an AI key: reads of the chat can run. */
  canRun: boolean;
  /** An AI key: the read can update itself from notes and memory. */
  canSync: boolean;
  state: ReadState;
  /** Whether the read still matches what is known now (`key` changes whenever notes or the timeline do). With no read yet, stale means enough has been told to build one. */
  advice: { stale: boolean; key: string; at?: string };
}) {
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

  // Live advice: rewritten on its own when notes, the timeline or the date change. No chat re-read.
  const [adviceFailed, setAdviceFailed] = useState(false);
  const adviceNoop = useRef(false);
  // First read being built from memory alone (no chat): shown as a placeholder, then loaded by refresh.
  const [building, setBuilding] = useState(false);
  const adv = useObject({
    api: `/api/people/${personId}/model`,
    schema: modelPatchSchema,
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      adviceNoop.current = res.status === 204; // already current (the coach or another tab updated it)
      if (res.ok && res.headers.get("x-model-mode") === "create") {
        // A whole new read, not a patch: wait for it to finish and be saved, then load it.
        adviceNoop.current = true;
        setBuilding(true);
        await res.text().catch(() => null);
        setBuilding(false);
        router.refresh();
      }
      return adviceNoop.current ? new Response("{}") : res;
    },
    onError: () => setAdviceFailed(true),
    onFinish: ({ error }) => {
      if (adviceNoop.current) return;
      if (error) return setAdviceFailed(true);
      router.refresh();
    },
  });
  function refreshAdvice() {
    setAdviceFailed(false);
    adv.submit({});
  }
  // Start by itself, once per context change.
  const triedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!advice.stale || !canSync || isLoading || triedFor.current === advice.key) return;
    triedFor.current = advice.key;
    refreshAdvice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advice.stale, advice.key, canSync, isLoading]);

  function run(mode: "auto" | "full") {
    adv.stop();
    adv.clear();
    setSelected(null);
    setBaseline(history[0]?.id);
    submit({ mode });
  }

  const latest = history[0];
  const waitingForRefresh = object && baseline !== null && latest?.id === baseline;
  const viewingLatest = !selected && !isLoading && !waitingForRefresh;
  const saved = (selected ? history.find((h) => h.id === selected) : latest)?.result;
  const shown: DeepPartial<Analysis> | undefined =
    isLoading || waitingForRefresh ? object : viewingLatest && adv.object ? overlay(saved, adv.object) : saved;
  const adviceStatus: AdviceStatus | undefined = viewingLatest && latest
    ? { state: adv.isLoading ? "updating" : adviceFailed && advice.stale ? "failed" : "idle", at: advice.at, refresh: refreshAdvice }
    : undefined;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display mr-auto text-3xl">The read</h2>
        {history.length > 1 && !isLoading && (
          <select aria-label="Past analyses" className="input h-9 w-auto" value={selected ?? latest?.id} onChange={(e) => setSelected(e.target.value === latest?.id ? null : e.target.value)}>
            {history.map((h) => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()}{h.mode === "incremental" ? " · update" : ""}</option>)}
          </select>
        )}
        {!isLoading && !waitingForRefresh && (selected ?? latest?.id) && (
          <ConfirmButton
            className="text-sm text-muted underline-offset-4 hover:text-heart hover:underline"
            action={() => trashItem("analysis", (selected ?? latest!.id)!)}
            title="Delete this read?"
            description="It moves to the trash; restore it from Trash within 30 days. Facts it added to the timeline stay."
            confirmLabel="Move to trash"
            onDone={() => {
              toast.success("Read moved to trash");
              setSelected(null);
              router.refresh();
            }}
          >
            Delete read
          </ConfirmButton>
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
            {hasChat ? (
              <button className="btn-primary" disabled={!canRun || state === "current"} onClick={() => run("auto")}>
                {state === "update" ? "Update with new messages" : state === "current" ? "Up to date" : "Analyze chat"}
              </button>
            ) : (
              <Link href={`/people/${personId}/coach`} className="btn-primary">Tell the coach more</Link>
            )}
          </>
        )}
      </div>

      {!shown && !isLoading && (
        <div className="card grid place-items-center px-6 py-16 text-center text-muted">
          {building ? (
            <span className="animate-pulse text-mint" aria-busy>Building the read from what you&apos;ve told the coach…</span>
          ) : canRun ? (
            "Hit analyze. It takes 20–60 seconds depending on chat size."
          ) : hasChat ? (
            "Add an AI key in Settings to run a read."
          ) : (
            <p className="max-w-md">
              No chat needed to start. <Link href={`/people/${personId}/coach`} className="text-heart underline-offset-4 hover:underline">Tell the coach</Link> what&apos;s
              happened between you two, and the read builds itself here. Uploading a chat later makes it sharper.
            </p>
          )}
        </div>
      )}
      {isLoading && !object?.status && <div className="card h-48 animate-pulse" aria-busy />}
      {shown && <Report a={shown} live={isLoading} advice={adviceStatus} />}
    </section>
  );
}

const SIGNALS = [
  ["reciprocity", "Matches your effort"], ["warmth", "Warmth"], ["curiosityAboutUser", "Curious about you"], ["effort", "Effort in replies"],
  ["consistency", "Consistency"], ["selfDisclosure", "Opens up"], ["futureTalk", "Talks about plans"],
] as const;

const TREND = { warming: "▲ warming", steady: "● steady", cooling: "▼ cooling" } as const;

const SECTIONS = [
  ["now", "Now"], ["person", "Who they are"], ["memory", "Memory"], ["story", "Your story"], ["you", "Your side"], ["moves", "What to do"],
] as const;

function Report({ a, live, advice }: { a: DeepPartial<Analysis>; live: boolean; advice?: AdviceStatus }) {
  const score = a.status?.score == null ? undefined : Math.round(a.status.score);
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast.success("Copied"));
  return (
    <div className="space-y-10" aria-live="polite">
      <nav aria-label="Report sections" className="sticky top-16 z-10 -mx-1 flex gap-1 overflow-x-auto bg-ink/90 py-2 backdrop-blur">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#r-${id}`} className="chip shrink-0 hover:border-heart/50 hover:text-paper">{label}</a>
        ))}
      </nav>

      {advice && (advice.state !== "idle" || a.whatChanged || advice.at) && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm" aria-live="polite">
          {advice.state === "updating" ? (
            <span className="animate-pulse text-mint">Updating with what’s new…</span>
          ) : advice.state === "failed" ? (
            <>
              <span className="text-amber">Something new isn’t in this read yet.</span>
              <button className="text-heart underline-offset-4 hover:underline" onClick={advice.refresh}>Update now</button>
            </>
          ) : (
            <>
              {a.whatChanged && <span className="min-w-0 flex-1 text-muted">{a.whatChanged}</span>}
              {advice.at && <span className="chip shrink-0">Updated {new Date(advice.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>}
            </>
          )}
        </div>
      )}
      <Group id="now" title="Where things stand">
        {a.status && (
          <div className="card flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
            <ScoreRing score={score} />
            <div className="min-w-0">
              <p className="display text-3xl italic">{a.status.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {a.status.trend && <span className={`chip ${a.status.trend === "cooling" ? "text-amber" : a.status.trend === "warming" ? "text-mint" : ""}`}>{TREND[a.status.trend]}</span>}
                {a.status.confidence && <span className="chip">{a.status.confidence} confidence</span>}
              </div>
              <p className="mt-3 leading-relaxed text-muted">{a.status.explanation}</p>
            </div>
          </div>
        )}
        {a.signals && (
          <Block title="What the score is built on">
            <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {SIGNALS.map(([k, label]) => {
                const sg = a.signals?.[k];
                if (typeof sg?.level !== "number") return null;
                return (
                  <li key={k}>
                    <div className="flex items-center justify-between text-sm"><span>{label}</span><span className="font-mono text-dim">{sg.level}/4</span></div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-ink-3" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={sg.level}>
                      <div className="h-full rounded-full bg-heart transition-[width] duration-500" style={{ width: `${(sg.level / 4) * 100}%` }} />
                    </div>
                    {sg.evidence && <p className="mt-1.5 text-xs italic text-muted">{sg.evidence}</p>}
                  </li>
                );
              })}
            </ul>
          </Block>
        )}
        {a.emotional && (
          <Block title="Their mood lately">
            <p className="leading-relaxed text-muted">{a.emotional.currentMood}</p>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <Bullets title="What upsets them" items={a.emotional.triggers} dot="bg-amber" />
              <Bullets title="What comforts them" items={a.emotional.comforts} dot="bg-mint" />
            </div>
          </Block>
        )}
      </Group>

      <Group id="person" title="Who they are">
        {a.mind && (
          <Block title="How they think" tone="heart">
            <dl className="grid gap-5 md:grid-cols-2">
              {a.mind.howTheySeeYou?.view && <Mind label="How they see you" text={a.mind.howTheySeeYou.view} evidence={a.mind.howTheySeeYou.evidence} />}
              {a.mind.whatTheyWant?.want && <Mind label="What they want from this" text={a.mind.whatTheyWant.want} evidence={a.mind.whatTheyWant.evidence} />}
              {a.mind.investment && <Mind label="How much they put in" text={a.mind.investment} />}
              {a.mind.emotionalPattern && <Mind label="How they show feelings" text={a.mind.emotionalPattern} />}
            </dl>
            <div className="mt-6"><Bullets title="Not clear yet" items={a.mind.unknowns} dot="bg-dim" /></div>
          </Block>
        )}
        {a.personality && (
          <Block title="Personality">
            <p className="leading-relaxed text-muted">{a.personality.summary}</p>
            <Evidence items={a.personality.traits} k="trait" />
          </Block>
        )}
        {a.communicationStyle && <Block title="How they text"><p className="leading-relaxed text-muted">{a.communicationStyle}</p></Block>}
        {!!a.loveLanguages?.length && <Block title="Love languages"><Evidence items={a.loveLanguages} k="language" /></Block>}
        {!!a.interests?.length && <Block title="Interests"><Evidence items={a.interests} k="topic" /></Block>}
        <div className="grid gap-4 md:grid-cols-2">
          <List title="They love" items={a.likes} dot="bg-heart" />
          <List title="They don't like" items={a.dislikes} dot="bg-dim" />
        </div>
      </Group>

      {(!!a.keyFacts?.length || !!a.importantDates?.length || !!a.openThreads?.length) && (
        <Group id="memory" title="Details worth remembering">
          {!!a.keyFacts?.length && (
            <Block title="Key facts">
              <ul className="grid gap-2 sm:grid-cols-2">
                {a.keyFacts.map((f, i) => f?.fact && (
                  <li key={i} className="rounded-xl bg-ink-3 px-3 py-2 text-sm">
                    {f.fact}
                    <span className="mt-0.5 block text-xs text-dim">{f.category}{f.when ? ` · ${f.when}` : ""}</span>
                  </li>
                ))}
              </ul>
              {!live && <p className="mt-4 text-xs text-dim">New details are saved to the Timeline automatically.</p>}
            </Block>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {!!a.importantDates?.length && (
              <Block title="Important dates">
                <ul className="space-y-2 text-sm">
                  {a.importantDates.map((d, i) => d?.what && <li key={i}><span className="font-mono text-amber">{d.date}</span> · {d.what}</li>)}
                </ul>
              </Block>
            )}
            <List title="Open threads" items={a.openThreads} dot="bg-amber" />
          </div>
        </Group>
      )}

      {(!!a.timeline?.length || a.conflicts) && (
        <Group id="story" title="Your story so far">
          {!!a.timeline?.length && (
            <Block title="Phases">
              <ol className="space-y-4 border-l border-line pl-5">
                {a.timeline.map((t, i) => t?.phase && (
                  <li key={i}>
                    <p className="text-xs text-dim">{t.period}</p>
                    <p className="font-medium">{t.phase}</p>
                    <p className="mt-1 text-sm text-muted">{t.summary}</p>
                  </li>
                ))}
              </ol>
            </Block>
          )}
          {a.conflicts && (
            <Block title="Conflicts">
              {a.conflicts.length ? (
                <ul className="space-y-4">
                  {a.conflicts.map((c, i) => c?.about && (
                    <li key={i} className="text-sm">
                      <p><span className="text-dim">{c.when}</span> · {c.about} <span className={`chip ml-1 ${c.resolved ? "text-mint" : "text-amber"}`}>{c.resolved ? "resolved" : "open"}</span></p>
                      {c.lesson && <p className="mt-1 text-muted">{c.lesson}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-dim">No real conflicts so far.</p>}
            </Block>
          )}
        </Group>
      )}

      <Group id="you" title="Your side">
        {a.yourSide && (
          <div className="grid gap-4 md:grid-cols-2">
            <List title="What you do well" items={a.yourSide.strengths} dot="bg-mint" />
            <List title="Blind spots" items={a.yourSide.blindSpots} dot="bg-amber" />
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <List title="Green flags" items={a.greenFlags} dot="bg-mint" />
          <List title="Red flags" items={a.redFlags} dot="bg-amber" empty="None spotted." />
        </div>
      </Group>

      <Group id="moves" title="What to do">
        {!!a.nextMoves?.length && (
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
        )}
        {!!a.messageSuggestions?.length && (
          <Block title="Things you could send" tone="heart">
            <ul className="space-y-2">
              {a.messageSuggestions.map((s, i) => s && (
                <li key={i} className="flex items-start justify-between gap-3 rounded-2xl rounded-br-md bg-heart/10 px-4 py-3">
                  <span className="text-sm">{s}</span>
                  {!live && <button className="shrink-0 text-xs text-heart hover:underline" onClick={() => copy(s)}>Copy</button>}
                </li>
              ))}
            </ul>
          </Block>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <List title="Conversation starters" items={a.conversationStarters} dot="bg-heart" />
          <List title="Keep in mind" items={a.thingsToCareAbout} dot="bg-paper" />
          <List title="Avoid" items={a.avoid} dot="bg-heart-2" />
        </div>
      </Group>

      {!!a.observations?.length && (
        <details className="card p-6 sm:p-8">
          <summary className="label cursor-pointer">Evidence this read is built on ({a.observations.length})</summary>
          <ul className="mt-4 space-y-3">
            {a.observations.map((o, i) => o?.quote && (
              <li key={i} className="rounded-2xl bg-ink-3 p-4 text-sm">
                <p className="font-mono text-xs text-dim">{o.when}{o.signal ? ` · ${o.signal}` : ""}</p>
                <p className="mt-1 italic">“{o.quote}”</p>
                {o.reading && <p className="mt-1 text-muted">{o.reading}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`r-${id}`} className="scroll-mt-32 space-y-4">
      <h3 className="display text-2xl text-paper/90">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ title, items, dot }: { title: string; items?: (string | undefined)[]; dot: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="label">{title}</p>
      <ul className="space-y-2">
        {items.map((t, i) => t && <li key={i} className="flex gap-3 text-sm"><span className={`mt-2 size-1.5 shrink-0 rounded-full ${dot}`} />{t}</li>)}
      </ul>
    </div>
  );
}

function Evidence({ items, k }: { items?: (Record<string, string | undefined> | undefined)[]; k: string }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {items.map((it, i) => it?.[k] && (
        <li key={i} className="rounded-2xl bg-ink-3 p-4">
          <p className="font-medium">{it[k]}</p>
          {it.evidence && <p className="mt-1 text-sm italic text-muted">“{it.evidence}”</p>}
        </li>
      ))}
    </ul>
  );
}

function Mind({ label, text, evidence }: { label: string; text: string; evidence?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="leading-relaxed">{text}</dd>
      {evidence && <dd className="mt-1 text-sm italic text-muted">“{evidence}”</dd>}
    </div>
  );
}

/** Score is computed server-side after the read finishes, so it is blank while streaming. */
function ScoreRing({ score }: { score?: number }) {
  const c = 2 * Math.PI * 42;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={score == null ? "Score pending" : `Score ${score} of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--heart)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (score ?? 0) / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <span className="display absolute inset-0 grid place-items-center text-4xl">{score ?? "…"}</span>
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
