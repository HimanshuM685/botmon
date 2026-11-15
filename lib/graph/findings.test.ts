import { expect, it } from "vitest";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "../graph";
import { contextHash } from "../context";
import { diffFindings, newSince, type StoredFinding } from "./findings";

const NOW = Date.UTC(2026, 10, 15);
const DAY = 86_400_000;
type Said = { by: "them" | "me"; daysAgo: number; polarity?: number; tone?: string };
type Memory = { id: string; text: string; date?: string; triples: Triple[]; said?: Said };

/** A graph whose edges already carry mined evidence (who said it, when, how). */
function make(memories: Memory[], alive = memories.map((m) => m.id)) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  for (const m of memories) {
    const p = planMemory(nodes, edges, { factId: m.id, triples: m.triples }, { personName: "Riya", newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges.map((e) => (m.said && e.factId ? { ...e, at: new Date(NOW - m.said.daysAgo * DAY), quoteSender: m.said.by, polarity: m.said.polarity ?? null, tone: m.said.tone ?? null, quoted: true } : e)));
  }
  const facts: GFact[] = memories.filter((m) => alive.includes(m.id)).map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null }));
  return buildGraph(nodes, edges, facts, { them: "Riya" });
}
const kinds = (g: ReturnType<typeof make>) => g.tensions([], 20, false, NOW).map((t) => t.kind);

it("attention: she brings back, three weeks later, something I said first", () => {
  const mine = { id: "a", text: "I want to see the northern lights someday", triples: [{ from: "me", rel: "WANTS", to: "northern lights" }], said: { by: "me", daysAgo: 30 } as Said };
  const hers = { id: "b", text: "She sent a northern lights tour she found for me", triples: [{ from: "them", rel: "DID_FOR", to: "northern lights", label: "found a tour" }], said: { by: "them", daysAgo: 9, tone: "warm" } as Said };
  const g = make([mine, hers]);
  const [t] = g.tensions([], 20, false, NOW);
  expect(t).toMatchObject({ kind: "attention", confidence: 0.9 });
  expect(t.key).toBe(`attention|${g.resolve("northern lights")!.id}`);
  expect(t.text).toContain("Remembered: Riya brought up northern lights on 2026-11-06");
  expect(t.text).toContain("21 days after the user first mentioned it");
  expect(t.edgeIds).toHaveLength(2);
  // Not when she said it first, nor when it came back within the week.
  expect(kinds(make([{ ...mine, said: { by: "them", daysAgo: 30 } }, hers]))).toEqual([]);
  expect(kinds(make([mine, { ...hers, said: { by: "them", daysAgo: 26 } }]))).toEqual([]);
});

it("drift: her own lines about me cooled over a month", () => {
  const line = (id: string, daysAgo: number, polarity: number) => ({ id, text: `line ${id}`, triples: [{ from: "them", rel: "RELATED_TO", to: "me", label: id }], said: { by: "them", daysAgo, polarity } as Said });
  const g = make([line("a", 80, 2), line("b", 60, 1), line("c", 45, 2), line("d", 20, 0), line("e", 5, -1)]);
  const [t] = g.tensions([], 20, false, NOW);
  expect(t.kind).toBe("drift");
  expect(t.text).toContain("Cooling about the user: Riya's own lines about the user averaged +1.7 before and -0.5 in the last 30 days");
  expect(kinds(make([line("a", 80, 1), line("b", 60, 1), line("d", 20, 1), line("e", 5, 0)]))).toEqual([]); // half a point is not a drift
  expect(kinds(make([line("a", 80, 2), line("d", 20, -2), line("e", 5, -2)]))).toEqual([]); // one old line is not a baseline
});

it("open promise: planned, dated, and nothing about it since", () => {
  const promise = { id: "p", text: "She promised to show me her paintings", date: "2026-10-01", triples: [{ from: "them", rel: "DID_FOR", to: "her paintings", label: "promised to show" }] };
  const g = make([promise]);
  expect(g.tensions([], 20, false, NOW)[0]).toMatchObject({ kind: "open_promise" });
  expect(g.tensions([], 20, false, NOW)[0].text).toContain("Open promise: Riya promised to show her paintings on 2026-10-01");
  expect(kinds(make([promise, { id: "q", text: "She showed me her paintings", date: "2026-10-20", triples: [{ from: "them", rel: "DID_FOR", to: "her paintings", label: "showed me" }] }]))).toEqual([]); // kept
  expect(g.tensions([], 20, false, Date.UTC(2026, 9, 5))).toEqual([]); // four days old: not open yet
  expect(kinds(make([{ ...promise, date: undefined }]))).toEqual([]); // no date, no claim about how long
});

it("findings are stored once, updated when they change, retired when the evidence goes, and new again when it returns", () => {
  const offer = { id: "f2", text: "Offered to cook cheese though she dislikes it", triples: [{ from: "them", rel: "DISLIKES", to: "cheese" }, { from: "them", rel: "DID_FOR", to: "cheese", label: "offered" }] };
  const t0 = new Date(NOW), t1 = new Date(NOW + DAY), t2 = new Date(NOW + 2 * DAY), t3 = new Date(NOW + 3 * DAY);
  const shown = make([offer]).tensions([], 50);
  const first = diffFindings([], shown, t0);
  expect(first.create.map((f) => f.kind)).toEqual(["cost"]);
  expect(first).toMatchObject({ update: [], retire: [] });
  const stored: StoredFinding[] = first.create.map((f) => ({ ...f, retiredAt: null }));
  expect(diffFindings(stored, shown, t1)).toEqual({ create: [], update: [], retire: [] }); // nothing changed, nothing written
  expect(diffFindings(stored, [{ ...shown[0], confidence: 0.9 }], t1).update).toMatchObject([{ confidence: 0.9, firstSeenAt: t0, lastSeenAt: t1 }]);
  // The memory is trashed: its edges leave the graph, the finding retires.
  const gone = diffFindings(stored, make([offer], []).tensions([], 50), t2);
  expect(gone.retire).toEqual([shown[0].key]);
  const back = diffFindings(stored.map((f) => ({ ...f, retiredAt: t2 })), shown, t3);
  expect(back.update).toMatchObject([{ retiredAt: null, firstSeenAt: t3 }]);
  // A risk depends on what is being discussed, so it is never stored.
  expect(diffFindings([], [{ kind: "risk", key: "risk|a|b", text: "", edgeIds: [], confidence: 1 }], t0).create).toEqual([]);
});

it("a new finding is new: it leads the brief, and changes the read's fingerprint", () => {
  const offer = { id: "f2", text: "Offered to cook cheese though she dislikes it", triples: [{ from: "them", rel: "DISLIKES", to: "cheese" }, { from: "them", rel: "DID_FOR", to: "cheese", label: "offered" }] };
  const promise = { id: "p", text: "She promised to show me her paintings", date: "2026-10-01", triples: [{ from: "them", rel: "DID_FOR", to: "her paintings", label: "promised to show" }] };
  const g = make([offer, promise]);
  const all = g.tensions([], 20, false, NOW);
  const stored = all.map((t, i) => ({ key: t.key, firstSeenAt: new Date(NOW - (i ? 1 : 5) * DAY), retiredAt: null }));
  const fresh = newSince(stored, new Date(NOW - 2 * DAY));
  expect([...fresh]).toEqual([all[1].key]);
  expect(newSince(stored, undefined).size).toBe(0);
  const brief = g.brief([], fresh).split("\n");
  expect(brief[1]).toMatch(/^! New since we last spoke: Open promise/);
  expect(brief[2]).toMatch(/^! Effort at a cost/);

  const person = { notes: null, relation: "FRIEND", gender: "FEMALE" }, facts = [{ id: "a", updatedAt: new Date(NOW) }];
  const before = contextHash(person, facts);
  expect(contextHash(person, facts, [])).toBe(before); // fingerprints from before findings existed stay valid
  expect(contextHash(person, facts, ["cost|x|y"])).not.toBe(before);
  expect(contextHash(person, facts, ["b", "a"])).toBe(contextHash(person, facts, ["a", "b"]));
});
