import { readdirSync, readFileSync } from "node:fs";
import { buildGraph, planMemory, type GEdge, type GFact, type GNode, type Triple } from "@/lib/graph";
import { acceptCategories, applyMerges, needsCategory, type CategoryAnswer } from "@/lib/graph/categories";
import type { Msg } from "@/lib/parsers/types";

/**
 * Scenario fixtures (tests/fixtures/scenarios/*.json): a small synthetic chat, the memories a read would take
 * from it, and what the graph must then show. `npm test` runs them with the model's answers given by the fixture
 * (`categories`, `evidence`); `npm run eval` runs the same chats through a real model (scripts/eval.mts).
 */
export type Scenario = {
  name: string; about: string; person: string; me: string; now: string;
  chat: { at: string; from: string; text: string }[];
  memories: { id: string; text: string; date?: string; tags?: string[]; triples: Triple[] }[];
  /** What the cheap model answers in the category step. */
  categories?: CategoryAnswer[];
  /** The chat line the evidence step picks for an edge, and how it was said. */
  evidence?: { memory: string; rel: string; line: string; tone: string; polarity: number }[];
  /** What the user is asking about (decides `risk`), and the question put to the coach in the eval. */
  focus?: string;
  ask: string;
  not?: string[];
  notEdges?: string[];
  expect: { edges: string[]; findings: string[]; quote?: string; text?: string; history?: string[]; aliases?: Record<string, string[]>; kinds?: Record<string, string>; neighbours?: Record<string, string[]> };
};

export const loadScenarios = (): Scenario[] => {
  const dir = new URL("./fixtures/scenarios/", import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
};

export const chatOf = (s: Scenario): Msg[] => s.chat.map((m) => ({ sender: m.from, text: m.text, ts: Date.parse(`${m.at.replace(" ", "T")}:00Z`) })).sort((a, b) => a.ts - b.ts);

/** Build the scenario's graph the way the app does: plan each memory, run the category step, attach the evidence. */
export function buildScenario(s: Scenario, memories = s.memories) {
  const nodes: GNode[] = [], edges: GEdge[] = [];
  let n = 0;
  const add = (item: { factId: string; tags?: string[]; triples?: Triple[] }) => {
    const p = planMemory(nodes, edges, item, { personName: s.person, newId: () => `x${++n}` });
    nodes.push(...p.nodes);
    edges.push(...p.edges);
    for (const a of p.aliases) nodes.find((x) => x.id === a.nodeId)!.aliases.push(a.alias);
  };
  for (const m of memories) add({ factId: m.id, tags: m.tags, triples: m.triples });
  if (s.categories) {
    const plan = acceptCategories(s.categories, needsCategory(nodes, edges), nodes, edges);
    applyMerges(nodes, edges, plan.merges);
    add({ factId: "", triples: plan.triples });
  }
  const msgs = chatOf(s);
  for (const ev of s.evidence ?? []) {
    const edge = edges.find((e) => e.factId === ev.memory && e.rel === ev.rel), msg = msgs.find((m) => m.text === ev.line);
    if (!edge || !msg) throw new Error(`${s.name}: evidence for ${ev.memory} ${ev.rel} does not match an edge and a chat line`);
    Object.assign(edge, { at: new Date(msg.ts), tone: ev.tone, polarity: ev.polarity, quoted: true, quoteSender: msg.sender === s.me ? "me" : "them" });
  }
  const facts: GFact[] = memories
    .map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null }))
    .sort((a, b) => (a.happenedAt?.getTime() ?? Infinity) - (b.happenedAt?.getTime() ?? Infinity));
  const graph = buildGraph(nodes, edges, facts, { them: s.person });
  const findings = graph.tensions(s.focus ? graph.mentioned(s.focus).map((x) => x.id) : [], 50, false, Date.parse(s.now));
  return { nodes, edges, facts, msgs, graph, findings, add, plain: (e: GEdge) => `${graph.name(e.fromId)} ${e.rel} ${graph.name(e.toId)}` };
}
