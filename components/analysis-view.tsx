"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useObject } from "@ai-sdk/react";
import type { DeepPartial } from "ai";
import { toast } from "sonner";
import { analysisSchema, modelPatchSchema, type Analysis, type ModelPatch } from "@/lib/ai/schema";
import { loadRead, trashItem } from "@/app/actions";
import { PROVIDERS, type ProviderId } from "@/lib/ai/models";
import { ConfirmButton } from "./confirm-button";

/** `result` comes with the newest read only; older ones are fetched when picked. */
type Saved = { id: string; createdAt: string; model: string; mode: string; result?: Analysis };
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

export type ChatNumber = { label: string; value: string; hint: string };
const menuItem = "block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink-3 disabled:opacity-50";

export function AnalysisView({ personId, history, hasChat, canRun, canSync, state, advice, chatNumbers }: {
  /** Counted from the chat itself (who starts, reply times); shown with the score's breakdown. */
  chatNumbers?: ChatNumber[];
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
  const [older, setOlder] = useState<Record<string, Analysis>>({});
  const [picking, setPicking] = useState<string | null>(null);
  // Bumped by every pick and every run: an older read that finishes loading after that must not take over the view.
  const pickSeq = useRef(0);
  async function pick(id: string) {
    const seq = ++pickSeq.current;
    if (id === history[0]?.id) return setSelected(null);
    if (!older[id]) {
      setPicking(id);
      const r = await loadRead(id).catch(() => null);
      setPicking(null);
      if (!r) return toast.error("Couldn't load that read. Try again.");
      setOlder((o) => ({ ...o, [id]: r }));
      if (seq !== pickSeq.current) return;
    }
    setSelected(id);
  }
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

  // Long chats: every earlier period is read once (history route) before a read, so nothing old is skipped.
  const [reading, setReading] = useState<{ done: number; total: number; next?: string | null; wait?: boolean } | null>(null);
  const [ask, setAsk] = useState<{ mode: "auto" | "full"; todo: number; chars: number; provider: ProviderId } | null>(null);
  const stopReading = useRef(false);
  const historyUrl = `/api/people/${personId}/history`;

  async function readHistory(total: number, todo: number) {
    stopReading.current = false;
    setReading({ done: total - todo, total });
    try {
      while (!stopReading.current) {
        const res = await fetch(historyUrl, { method: "POST" });
        const j = await res.json().catch(() => ({ error: "Couldn't read this part. Try again." }));
        if (!res.ok) {
          toast.error(j.error ?? "Couldn't read this part. Try again.");
          return false;
        }
        if (j.gone) {
          router.refresh();
          return false;
        }
        if (j.retryAfter) {
          // Rate limit or another tab reading: what is read is saved; wait, then carry on.
          setReading((r) => r && { ...r, wait: true });
          for (let s = 0; s < j.retryAfter && !stopReading.current; s++) await new Promise((ok) => setTimeout(ok, 1000));
          setReading((r) => r && { ...r, wait: false });
          continue;
        }
        setReading({ done: j.total - j.todo, total: j.total, next: j.next });
        if (!j.todo) return true;
      }
      toast.info("Stopped. Everything read so far is kept; it carries on from there next time.");
      return false;
    } finally {
      setReading(null);
    }
  }

  async function run(mode: "auto" | "full", confirmed = false) {
    setAsk(null);
    if (hasChat) {
      const s = await fetch(historyUrl).then((r) => r.json()).catch(() => null);
      if (s?.error) return toast.error(s.error);
      if (s?.todo > 0) {
        // A long first run: say what it costs before spending the user's quota.
        if (s.todo > 3 && s.todo === s.total && !confirmed) return setAsk({ mode, todo: s.todo, chars: s.chars, provider: s.provider });
        if (!(await readHistory(s.total, s.todo))) return;
      }
    }
    adv.stop();
    adv.clear();
    pickSeq.current++;
    setSelected(null);
    setBaseline(history[0]?.id);
    submit({ mode });
  }

  const latest = history[0];
  const waitingForRefresh = object && baseline !== null && latest?.id === baseline;
  const viewingLatest = !selected && !isLoading && !waitingForRefresh;
  const saved = selected ? older[selected] : latest?.result;
  const shown: DeepPartial<Analysis> | undefined =
    isLoading || waitingForRefresh ? object : viewingLatest && adv.object ? overlay(saved, adv.object) : saved;
  const adviceStatus: AdviceStatus | undefined = viewingLatest && latest
    ? { state: adv.isLoading ? "updating" : adviceFailed && advice.stale ? "failed" : "idle", at: advice.at, refresh: refreshAdvice }
    : undefined;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display mr-auto text-3xl">The read</h2>
        {!isLoading && !reading && !waitingForRefresh && latest && (
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none [&::-webkit-details-marker]:hidden">More</summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-line bg-ink-2 p-2 shadow-2xl">
              {history.length > 1 && (
                <label className="block px-3 py-2 text-xs text-muted">
                  Earlier reads
                  <select className="input mt-1.5 h-9 w-full" value={picking ?? selected ?? latest.id} disabled={!!picking} onChange={(e) => pick(e.target.value)}>
                    {history.map((h) => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()}{h.mode === "incremental" ? " · update" : ""}</option>)}
                  </select>
                </label>
              )}
              {state !== "none" && <button className={menuItem} disabled={!canRun} onClick={() => void run("full")}>Re-read the whole chat</button>}
              <ConfirmButton
                className={`${menuItem} text-heart`}
                action={() => trashItem("analysis", selected ?? latest.id)}
                title="Delete this read?"
                description="It moves to the trash; restore it from Trash within 30 days. Facts it added to the timeline stay."
                confirmLabel="Move to trash"
                onDone={() => {
                  toast.success("Read moved to trash");
                  setSelected(null); // trashItem already revalidated this page
                }}
              >
                Delete this read
              </ConfirmButton>
            </div>
          </details>
        )}
        {reading ? (
          <button className="btn-ghost" onClick={() => (stopReading.current = true)}>Stop</button>
        ) : isLoading ? (
          <button className="btn-ghost" onClick={stop}>Stop</button>
        ) : (
          <>
            {hasChat ? (
              <button className="btn-primary" disabled={!canRun || state === "current"} onClick={() => void run("auto")}>
                {state === "update" ? "Update with new messages" : state === "current" ? "Up to date" : "Analyze chat"}
              </button>
            ) : (
              <Link href={`/people/${personId}/coach`} className="btn-primary">Tell the coach more</Link>
            )}
          </>
        )}
      </div>

      {ask && (
        <div className="card space-y-4 p-6 sm:p-8">
          <p className="display text-2xl">This chat is long.</p>
          <p className="text-sm leading-relaxed text-muted">
            To read all of it, nothing skipped, it&apos;s read in {ask.todo} parts, oldest first. That&apos;s about{" "}
            {Math.round(ask.chars / 4 / 100_000) / 10}M tokens on your {PROVIDERS[ask.provider]?.label ?? ask.provider} key, once: each part is kept, and later reads only add what&apos;s new.
          </p>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={() => run(ask.mode, true)}>Read all of it</button>
            <button className="btn-ghost" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      )}
      {reading && (
        <div className="card space-y-3 p-6 sm:p-8" aria-live="polite">
          <p className="text-sm">
            Reading your history: <strong>{reading.done} of {reading.total}</strong> parts
            {reading.wait ? <span className="text-amber"> · waiting for your AI provider&apos;s rate limit</span> : reading.next ? <span className="text-muted"> · {reading.next}</span> : null}
          </p>
          <div className="h-1.5 rounded-full bg-ink-3" role="progressbar" aria-valuemin={0} aria-valuemax={reading.total} aria-valuenow={reading.done}>
            <div className="h-full rounded-full bg-mint transition-[width] duration-500" style={{ width: `${(reading.done / Math.max(1, reading.total)) * 100}%` }} />
          </div>
          <p className="text-xs text-dim">Each part is saved as it&apos;s read. You can stop or leave, and it carries on from there. The read starts when it&apos;s done.</p>
        </div>
      )}
      {!shown && !isLoading && !reading && !ask && (
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
      {/* No read yet: the chat's own numbers need no AI, so they show straight away. */}
      {!shown && !isLoading && !!chatNumbers?.length && <div className="card p-6 sm:p-8"><Numbers items={chatNumbers} /></div>}
      {isLoading && !object?.status && <div className="card h-48 animate-pulse" aria-busy />}
      {shown && <Report a={shown} live={isLoading} advice={adviceStatus} personId={personId} chatNumbers={chatNumbers} />}
    </section>
  );
}

const SIGNALS = [
  ["reciprocity", "Matches your effort"], ["warmth", "Warmth"], ["curiosityAboutUser", "Curious about you"], ["effort", "Effort in replies"],
  ["consistency", "Consistency"], ["selfDisclosure", "Opens up"], ["futureTalk", "Talks about plans"],
] as const;

const TREND = { warming: "▲ warming", steady: "● steady", cooling: "▼ cooling" } as const;

/** Several lists as one: empty entries and case-insensitive repeats dropped. */
function merged(...lists: ((string | undefined)[] | undefined)[]): string[] {
  const seen = new Set<string>();
  return lists.flatMap((l) => l ?? []).filter((t): t is string => {
    const k = t?.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Answer first: where things stand, what to do, what to send. Then what to keep in mind.
 * Everything else is grouped by the question it answers and folded until wanted.
 */
function Report({ a, live, advice, personId, chatNumbers }: { a: DeepPartial<Analysis>; live: boolean; advice?: AdviceStatus; personId: string; chatNumbers?: ChatNumber[] }) {
  const score = a.status?.score == null ? undefined : Math.round(a.status.score);
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast.success("Copied"));
  const moves = a.nextMoves?.filter((m) => m?.action) ?? [];
  const sends = a.messageSuggestions?.filter((s): s is string => !!s) ?? [];
  const dos = merged(a.thingsToCareAbout, a.emotional?.comforts);
  const donts = merged(a.avoid, a.emotional?.triggers);
  const unfinished = merged(a.openThreads);
  const rated = SIGNALS.flatMap(([k, label]) => (typeof a.signals?.[k]?.level === "number" ? [{ label, level: a.signals[k]!.level! }] : []));
  const best = rated.length ? rated.reduce((x, y) => (y.level > x.level ? y : x)) : null;
  const worst = rated.length ? rated.reduce((x, y) => (y.level < x.level ? y : x)) : null;
  const openConflicts = a.conflicts?.filter((c) => c && !c.resolved).length ?? 0;
  const pad = "p-6 sm:p-8";

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="card divide-y divide-line">
        <div className={pad}>
          {live && <p className="mb-5 animate-pulse text-sm text-mint" aria-busy>Reading the chat… {a.observations?.length ?? 0} moments found</p>}
          {a.status && (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
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
          {advice && (advice.state !== "idle" || a.whatChanged || advice.at) && (
            <p className="mt-5 text-xs text-dim" aria-live="polite">
              {advice.state === "updating" ? (
                <span className="animate-pulse text-mint">Updating with what’s new…</span>
              ) : advice.state === "failed" ? (
                <>
                  <span className="text-amber">Something new isn’t in this read yet.</span>{" "}
                  <button className="text-heart underline-offset-4 hover:underline" onClick={advice.refresh}>Update now</button>
                </>
              ) : (
                <>
                  {advice.at && <>Updated {new Date(advice.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. </>}
                  {a.whatChanged}
                </>
              )}
            </p>
          )}
        </div>

        {moves.length > 0 && (
          <div className={pad}>
            <Block title="Do this next" tone="mint">
              <ol className="space-y-4">
                {moves.map((m, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="display text-2xl text-mint">{i + 1}</span>
                    <div>
                      <p className="font-medium">{m!.action}</p>
                      {m!.why && <p className="mt-1 text-sm text-muted">{m!.why}</p>}
                      {m!.when && <p className="chip mt-2">{m!.when}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </Block>
          </div>
        )}

        {sends.length > 0 && (
          <div className={pad}>
            <Block title="Send one of these" tone="heart">
              <ul className="space-y-2">
                {sends.map((s, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    {/* Each line is its own message, the way the user sends them. */}
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      {s.split("\n").filter(Boolean).map((line, j) => (
                        <span key={j} className="rounded-2xl rounded-bl-md bg-heart/10 px-4 py-2.5 text-sm">{line}</span>
                      ))}
                    </div>
                    {!live && <button className="mt-2.5 shrink-0 text-xs text-heart hover:underline" onClick={() => copy(s)}>Copy</button>}
                  </li>
                ))}
              </ul>
              {!!a.voiceFrom && <p className="mt-4 text-xs text-dim">Written the way you type, learned from {a.voiceFrom.toLocaleString()} of your own messages.</p>}
            </Block>
          </div>
        )}
      </div>

      {(dos.length > 0 || donts.length > 0 || unfinished.length > 0) && (
        <div className={`card grid gap-8 md:grid-cols-3 ${pad}`}>
          <Bullets title="Do" items={dos} dot="bg-mint" />
          <Bullets title="Don't" items={donts} dot="bg-heart-2" />
          <Bullets title="Unfinished between you" items={unfinished} dot="bg-amber" />
        </div>
      )}

      {(rated.length > 0 || !!chatNumbers?.length) && (
        <Fold title="Why this score" preview={best && worst && best !== worst ? `Strongest: ${best.label.toLowerCase()} · weakest: ${worst.label.toLowerCase()}` : undefined}>
          {rated.length > 0 && (
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
          )}
          {!!chatNumbers?.length && <Block title="From the chat itself"><Numbers items={chatNumbers} /></Block>}
        </Fold>
      )}

      {(a.mind || a.emotional?.currentMood) && (
        <Fold title="How they think" preview={a.mind?.howTheySeeYou?.view ?? a.emotional?.currentMood}>
          {a.mind && (
            <dl className="grid gap-5 md:grid-cols-2">
              {a.mind.howTheySeeYou?.view && <Mind label="How they see you" text={a.mind.howTheySeeYou.view} evidence={a.mind.howTheySeeYou.evidence} />}
              {a.mind.whatTheyWant?.want && <Mind label="What they want from this" text={a.mind.whatTheyWant.want} evidence={a.mind.whatTheyWant.evidence} />}
              {a.mind.investment && <Mind label="How much they put in" text={a.mind.investment} />}
              {a.mind.emotionalPattern && <Mind label="How they show feelings" text={a.mind.emotionalPattern} />}
            </dl>
          )}
          {a.emotional?.currentMood && <Block title="Their mood lately"><p className="leading-relaxed text-muted">{a.emotional.currentMood}</p></Block>}
          <Bullets title="Not clear yet" items={a.mind?.unknowns} dot="bg-dim" />
        </Fold>
      )}

      {(a.personality || a.communicationStyle || !!a.likes?.length || !!a.interests?.length || !!a.loveLanguages?.length || !!a.dislikes?.length) && (
        <Fold title="Who they are" preview={merged(a.personality?.traits?.map((t) => t?.trait)).join(" · ") || a.personality?.summary}>
          {a.personality && (
            <Block title="Personality">
              <p className="leading-relaxed text-muted">{a.personality.summary}</p>
              <Evidence items={a.personality.traits} k="trait" />
            </Block>
          )}
          {a.communicationStyle && <Block title="How they text"><p className="leading-relaxed text-muted">{a.communicationStyle}</p></Block>}
          {(!!a.likes?.length || !!a.interests?.length || !!a.loveLanguages?.length) && (
            <Block title="What they like">
              <Bullets items={a.likes} dot="bg-heart" />
              <Evidence items={a.interests} k="topic" />
              {!!a.loveLanguages?.length && <p className="mt-5 text-xs text-muted">How they give and want affection</p>}
              <Evidence items={a.loveLanguages} k="language" />
            </Block>
          )}
          <List title="What they don't" items={a.dislikes} dot="bg-dim" />
        </Fold>
      )}

      {(!!a.timeline?.length || a.conflicts) && (
        <Fold title="Your story" preview={`${a.timeline?.length ?? 0} phases · ${openConflicts ? `${openConflicts} open conflict${openConflicts === 1 ? "" : "s"}` : "no open conflicts"}`}>
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
        </Fold>
      )}

      {(a.yourSide || !!a.greenFlags?.length || !!a.redFlags?.length || !!a.conversationStarters?.length) && (
        <Fold title="Your side" preview={a.yourSide?.blindSpots?.[0] ? `Watch: ${a.yourSide.blindSpots[0]}` : undefined}>
          <div className="grid gap-8 md:grid-cols-2">
            <List title="What you do well" items={a.yourSide?.strengths} dot="bg-mint" />
            <List title="Blind spots" items={a.yourSide?.blindSpots} dot="bg-amber" />
            <List title="Green flags" items={a.greenFlags} dot="bg-mint" />
            <List title="Red flags" items={a.redFlags} dot="bg-amber" empty="None spotted." />
          </div>
          <List title="Things to talk about" items={a.conversationStarters} dot="bg-heart" />
        </Fold>
      )}

      {(!!a.keyFacts?.length || !!a.importantDates?.length) && (
        <Fold title="Remembered details" preview={`${a.keyFacts?.length ?? 0} details · ${a.importantDates?.length ?? 0} dates`}>
          {!!a.importantDates?.length && (
            <Block title="Important dates">
              <ul className="space-y-2 text-sm">
                {a.importantDates.map((d, i) => d?.what && <li key={i}><span className="font-mono text-amber">{d.date}</span> · {d.what}</li>)}
              </ul>
            </Block>
          )}
          <p className="text-sm text-muted">
            {live ? "Details from this read are saved to the Timeline when it finishes." : <>Everything this read picked up about them is on the <Link href={`/people/${personId}/timeline`} className="text-heart underline-offset-4 hover:underline">Timeline</Link>, where you can edit or remove it.</>}
          </p>
        </Fold>
      )}

      {!!a.observations?.length && (
        <Fold title="Evidence" preview={`${a.observations.length} moments from the chat this read is built on`}>
          <ul className="space-y-3">
            {a.observations.map((o, i) => o?.quote && (
              <li key={i} className="rounded-2xl bg-ink-3 p-4 text-sm">
                <p className="font-mono text-xs text-dim">{o.when}{o.signal ? ` · ${o.signal}` : ""}</p>
                <p className="mt-1 italic">“{o.quote}”</p>
                {o.reading && <p className="mt-1 text-muted">{o.reading}</p>}
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

/** The numbers counted from the chat itself: who starts, the split, reply times, recent activity. */
function Numbers({ items }: { items: ChatNumber[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((n) => (
        <div key={n.label}>
          <dt className="text-xs text-muted">{n.label}</dt>
          <dd className="display mt-1 text-2xl">{n.value}</dd>
          <dd className="text-xs text-dim">{n.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One folded section: a title, a one-line taste of what's inside, and the content on demand. */
function Fold({ title, preview, children }: { title: string; preview?: string; children: React.ReactNode }) {
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-baseline gap-4 px-6 py-4 sm:px-8 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted group-open:invisible">{preview}</span>
        <span aria-hidden className="text-dim transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-8 border-t border-line px-6 py-6 sm:px-8">{children}</div>
    </details>
  );
}

function Bullets({ title, items, dot }: { title?: string; items?: (string | undefined)[]; dot: string }) {
  if (!items?.length) return null;
  return (
    <div>
      {title && <p className="label">{title}</p>}
      <ul className="space-y-2">
        {items.map((t, i) => t && <li key={i} className="flex gap-3 text-sm leading-relaxed"><span className={`mt-2 size-1.5 shrink-0 rounded-full ${dot}`} />{t}</li>)}
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

/** A labelled part of a card or fold (no border of its own: no cards inside cards). */
function Block({ title, tone, children }: { title: string; tone?: "mint" | "heart"; children: React.ReactNode }) {
  const color = tone === "mint" ? "text-mint" : tone === "heart" ? "text-heart" : "text-muted";
  return (
    <div>
      <h4 className={`label mb-3 ${color}`}>{title}</h4>
      {children}
    </div>
  );
}

function List({ title, items, dot, empty }: { title: string; items?: (string | undefined)[]; dot: string; empty?: string }) {
  if (!items?.length && !empty) return null;
  return (
    <Block title={title}>
      {items?.length ? <Bullets items={items} dot={dot} /> : <p className="text-sm text-dim">{empty}</p>}
    </Block>
  );
}
