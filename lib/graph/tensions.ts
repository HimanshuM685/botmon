import type { GEdge, GNode, Tension } from "../graph";

/**
 * Findings that come from the shape of the graph, not from any single memory.
 * Each scan is separate; `collectTensions` keeps them in the order they are reported and stops at `max`.
 * - cost: they did or offered something involving X while they dislike, avoid or fear X or something X belongs with
 * - mixed: they like/want X and also dislike/avoid/fear it (or its family): changed over time, or two-sided
 * - risk: something in `focus` belongs with what they avoid or fear
 * - attention: they brought back something the user had said at least a week earlier (needs quoted edges)
 * - drift: how they speak about something, or about the user, moved between the last 30 days and before
 * - open_promise: something promised or planned, with nothing about it since
 * Only `risk` depends on `focus`. The rest are properties of the graph and are what gets stored.
 */

const POSITIVE = new Set(["LIKES", "WANTS"]);
const NEGATIVE = new Set(["DISLIKES", "AVOIDS", "FEARS"]);
const VERB: Record<string, string> = { DISLIKES: "dislike", AVOIDS: "avoid", FEARS: "fear", LIKES: "like", WANTS: "want", DID_FOR: "did or offered" };
/** How much the tone of a line supports reading it at face value: warm and sincere more, sarcastic and cold less. */
const TONE_WEIGHT: Record<string, number> = { warm: 0.9, sincere: 0.9, playful: 0.6, teasing: 0.5, reluctant: 0.4, annoyed: 0.25, cold: 0.25, sarcastic: 0.15 };
const toneWeight = (e: GEdge) => (e.tone ? TONE_WEIGHT[e.tone] ?? 0.7 : 0.7);
/** A "did it although it costs them" finding below this is not one: a sarcastic offer is not an act of care. */
const COST_MIN = 0.35;
const DAY = 86_400_000;
/** Bringing something back up after this many days counts as having remembered it. */
const ATTENTION_DAYS = 7;
/** Feelings are compared between the last DRIFT_DAYS and everything before; a shift of DRIFT_MIN (on -2..2) is a finding. */
const DRIFT_DAYS = 30, DRIFT_MIN = 1;
/** A promise or plan with nothing after it for this long is still open. */
const PROMISE_DAYS = 14;
const PROMISE = /promis|plan/i;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type TensionView = {
  themId: string | undefined;
  meId: string | undefined;
  nodes: GNode[];
  /** Working edges: superseded ones already removed. */
  edges: GEdge[];
  /** Every edge whose endpoints and memory are still alive, including ones a newer edge has overtaken. */
  live: GEdge[];
  /** Older edge id -> the edge that replaced it. */
  replaced: Map<string, GEdge>;
  /** When "now" is, so drift and open promises are stable in tests. */
  clock: number;
  name: (id: string) => string;
  family: (id: string) => Map<string, "itself" | "kind" | "related">;
  touching: (id: string) => GEdge[];
  evidence: (e: GEdge) => string;
  link: (x: string, y: string, how: "itself" | "kind" | "related") => string;
  when: (e: GEdge) => number | undefined;
  order: (e: GEdge) => number;
  hub: (id: string) => boolean;
};

const row = (kind: Tension["kind"], key: string, text: string, evidenceEdges: GEdge[], confidence: number): Tension =>
  ({ kind, key, text, edgeIds: evidenceEdges.map((e) => e.id), confidence });

function changed(view: TensionView, themId: string, relevant: (...ids: string[]) => boolean): Tension[] {
  const out: Tension[] = [];
  for (const [id, by] of view.replaced) {
    const was = view.live.find((e) => e.id === id);
    if (!was || was.fromId !== themId || !relevant(was.toId)) continue;
    const date = view.when(by);
    out.push(row(
      "mixed",
      `changed|${was.toId}`,
      `Changed${date ? ` on ${day(new Date(date))}` : " (date unknown)"}: ${view.name(themId)} used to ${VERB[was.rel]} ${view.name(was.toId)}${view.evidence(was)}, now they ${VERB[by.rel]} it${by.label ? ` (${by.label})` : ""}${view.evidence(by)}. Go by the newer one.`,
      [was, by],
      0.8,
    ));
  }
  return out;
}

function costAndMixed(view: TensionView, themId: string, relevant: (...ids: string[]) => boolean): Tension[] {
  const mine = view.edges.filter((e) => e.fromId === themId);
  const negatives = mine.filter((e) => NEGATIVE.has(e.rel));
  const out: Tension[] = [];
  for (const pos of mine.filter((e) => e.rel === "DID_FOR" || POSITIVE.has(e.rel))) {
    const fam = view.family(pos.toId);
    for (const neg of negatives) {
      const how = fam.get(neg.toId);
      if (!how || !relevant(pos.toId, neg.toId)) continue;
      if (neg.factId === pos.factId && how === "itself" && pos.rel !== "DID_FOR") continue; // one memory saying both: not a finding
      const cost = pos.rel === "DID_FOR";
      // A like and a dislike for merely related things (likes cheese, dislikes milk) is not a contradiction.
      if (!cost && how === "related") continue;
      // An offer made sarcastically or coldly is not an act of care: how it was said decides.
      const sure = cost ? toneWeight(pos) : 0.5;
      if (cost && sure < COST_MIN) continue;
      out.push(row(
        cost ? "cost" : "mixed",
        `${cost ? "cost" : "mixed"}|${pos.toId}|${neg.toId}`,
        cost
          ? `Effort at a cost: ${view.name(themId)} ${VERB.DID_FOR} something with ${view.name(pos.toId)}${pos.label ? ` (${pos.label})` : ""}${view.evidence(pos)} although they ${VERB[neg.rel]} ${view.name(neg.toId)}${neg.label ? ` (${neg.label})` : ""}${view.evidence(neg)}${view.link(pos.toId, neg.toId, how)}. Doing something that costs them is usually care for the user, not a change of taste.`
          : `Mixed or changed: ${view.name(themId)} ${VERB[pos.rel]} ${view.name(pos.toId)}${view.evidence(pos)} but also ${VERB[neg.rel]} ${view.name(neg.toId)}${neg.label ? ` (${neg.label})` : ""}${view.evidence(neg)}${view.link(pos.toId, neg.toId, how)}. Check the dates before assuming either.`,
        [pos, neg],
        sure,
      ));
    }
  }
  return out;
}

function risks(view: TensionView, themId: string, focus: string[]): Tension[] {
  const mine = view.edges.filter((e) => e.fromId === themId);
  const negatives = mine.filter((e) => NEGATIVE.has(e.rel));
  const out: Tension[] = [];
  for (const id of focus) {
    const fam = view.family(id);
    for (const neg of negatives.filter((e) => e.rel !== "DISLIKES" || fam.get(e.toId) === "itself")) {
      const how = fam.get(neg.toId);
      // Always reported (better a needless warning than a missed allergy); the tone only moves how sure it is.
      if (how) out.push(row("risk", `risk|${id}|${neg.toId}`, `Careful with ${view.name(id)}: ${view.name(themId)} ${VERB[neg.rel]} ${view.name(neg.toId)}${neg.label ? ` (${neg.label})` : ""}${view.evidence(neg)}${view.link(id, neg.toId, how)}.`, [neg], toneWeight(neg)));
    }
  }
  return out;
}

function attention(view: TensionView, themId: string, relevant: (...ids: string[]) => boolean): Tension[] {
  const out: Tension[] = [];
  for (const n of view.nodes.filter((node) => !view.hub(node.id) && relevant(node.id))) {
    const said = view.touching(n.id).filter((e) => e.at && e.quoteSender).sort((a, b) => a.at!.getTime() - b.at!.getTime());
    const first = said[0];
    const back = first?.quoteSender === "me" ? said.find((e) => e.quoteSender === "them" && e.at!.getTime() - first.at!.getTime() >= ATTENTION_DAYS * DAY) : undefined;
    if (back)
      out.push(row("attention", `attention|${n.id}`, `Remembered: ${view.name(themId)} brought up ${view.name(n.id)} on ${day(back.at!)}${view.evidence(back)}, ${Math.round((back.at!.getTime() - first.at!.getTime()) / DAY)} days after the user first mentioned it${view.evidence(first)}. Holding on to a detail like that is attention.`, [first, back], toneWeight(back)));
  }
  return out;
}

function drift(view: TensionView, themId: string, relevant: (...ids: string[]) => boolean): Tension[] {
  const me = view.meId ? view.nodes.find((n) => n.id === view.meId) : undefined;
  const things = view.nodes.filter((n) => !view.hub(n.id) && relevant(n.id));
  const out: Tension[] = [];
  for (const n of [...(me && relevant(me.id) ? [me] : []), ...things]) {
    const theirs = view.touching(n.id).filter((e) => e.quoteSender === "them" && e.at && e.polarity != null);
    const recent = theirs.filter((e) => view.clock - e.at!.getTime() <= DRIFT_DAYS * DAY), before = theirs.filter((e) => view.clock - e.at!.getTime() > DRIFT_DAYS * DAY);
    if (recent.length < 2 || before.length < 2) continue;
    const avg = (list: GEdge[]) => list.reduce((s, e) => s + e.polarity!, 0) / list.length;
    const [was, is] = [avg(before), avg(recent)];
    const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}`;
    if (Math.abs(is - was) >= DRIFT_MIN)
      out.push(row("drift", `drift|${n.id}`, `${is < was ? "Cooling" : "Warming"} about ${view.name(n.id)}: ${view.name(themId)}'s own lines about ${n.id === view.meId ? "the user" : "it"} averaged ${fmt(was)} before and ${fmt(is)} in the last ${DRIFT_DAYS} days (${recent.length} lines against ${before.length}), most recently${view.evidence(recent.at(-1)!)}.`, recent.slice(-4), 0.6));
  }
  return out;
}

function promises(view: TensionView, relevant: (...ids: string[]) => boolean): Tension[] {
  const out: Tension[] = [];
  for (const e of view.edges.filter((x) => (x.rel === "DID_FOR" || x.rel === "WANTS") && PROMISE.test(x.label ?? "") && view.hub(x.fromId) && relevant(x.toId))) {
    const said = view.when(e);
    if (!said || view.clock - said < PROMISE_DAYS * DAY || view.touching(e.toId).some((x) => x.id !== e.id && view.order(x) > view.order(e))) continue;
    out.push(row("open_promise", `open_promise|${e.toId}`, `Open promise: ${view.name(e.fromId)} ${e.label} ${view.name(e.toId)} on ${day(new Date(said))}${view.evidence(e)}, and nothing about it since (${Math.round((view.clock - said) / DAY)} days).`, [e], 0.7));
  }
  return out;
}

function take(list: Tension[], max: number): Tension[] {
  const seen = new Set<string>(), out: Tension[] = [];
  for (const t of list) {
    if (seen.has(t.key)) continue;
    if (out.length >= max) break;
    seen.add(t.key);
    out.push({ ...t, confidence: Math.round(t.confidence * 100) / 100 });
  }
  return out;
}

/** Findings in report order, capped. No `them` node means there is nothing they did. */
export function collectTensions(view: TensionView, focus: string[], local: boolean, max: number): Tension[] {
  if (!view.themId) return [];
  const themId = view.themId;
  const near = new Set(focus.flatMap((id) => [...view.family(id).keys()]));
  const relevant = (...ids: string[]) => !local || ids.some((id) => near.has(id));
  return take([
    ...changed(view, themId, relevant),
    ...costAndMixed(view, themId, relevant),
    ...risks(view, themId, focus),
    ...attention(view, themId, relevant),
    ...drift(view, themId, relevant),
    ...promises(view, relevant),
  ], max);
}
