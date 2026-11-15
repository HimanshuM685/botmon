// End-to-end check of the coach's brain on the scenario fixtures, with a real model and no database.
//   EVAL_PROVIDER=GEMINI EVAL_API_KEY=... npm run eval
//   optional: EVAL_MODEL (default: the provider's first suggested model), EVAL_RUNS (default 1), EVAL_ONLY=cheese-cost
// Skipped (exit 0) when EVAL_PROVIDER or EVAL_API_KEY is not set.
// Per scenario: the real read extracts memories and triples from the chat, the cheap model does the category and
// evidence steps, then the coach answers the fixture's question with its tools. A pass needs the expected
// findings in the graph AND the exact chat line quoted in the coach's answer.
import "dotenv/config";
import { generateText, Output, stepCountIs } from "ai";
import { getModel } from "@/lib/ai/provider";
import { cheapAsk } from "@/lib/ai/cheap";
import { CHAR_BUDGET, PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/ai/models";
import { analysisSchema } from "@/lib/ai/schema";
import { buildPrompt, SYSTEM } from "@/lib/ai/prompt";
import { buildCoachContext, capFor, COACH_STEPS, COACH_SYSTEM, coachTools } from "@/lib/ai/coach";
import { factsFromAnalysis } from "@/lib/facts";
import { computeStats } from "@/lib/stats";
import { voiceForPrompt, voiceProfile } from "@/lib/voice";
import { buildGraph } from "@/lib/graph";
import { acceptCategories, applyMerges, categoryAnswerSchema, categoryPrompt, needsCategory } from "@/lib/graph/categories";
import { acceptEvidence, evidenceAnswerSchema, evidenceItem, evidencePrompt, renderItem } from "@/lib/graph/evidence";
import { buildScenario, loadScenarios, type Scenario } from "../tests/scenarios";

const provider = process.env.EVAL_PROVIDER?.toUpperCase() as ProviderId | undefined;
const apiKey = process.env.EVAL_API_KEY;
if (!provider || !apiKey) {
  console.log("eval skipped: set EVAL_PROVIDER and EVAL_API_KEY to run it.");
  process.exit(0);
}
if (!PROVIDER_IDS.includes(provider)) {
  console.error(`EVAL_PROVIDER must be one of ${PROVIDER_IDS.join(", ")}`);
  process.exit(1);
}
const modelId = process.env.EVAL_MODEL || PROVIDERS[provider].models[0];
const key = { provider, apiKey, model: modelId };
const model = getModel(provider, apiKey, modelId);
const ask = cheapAsk(key);
const runs = Math.max(1, Number(process.env.EVAL_RUNS) || 1);
const budget = CHAR_BUDGET[provider];

/** Same text whatever the quotes, case and spacing: a quote counts when its words are all there in order. */
const norm = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

async function runOnce(s: Scenario): Promise<{ ok: boolean; why: string }> {
  const now = Date.parse(s.now);
  const base = buildScenario({ ...s, categories: undefined, evidence: undefined });
  const { msgs } = base;
  const stats = msgs.length ? computeStats(msgs, s.me, 0) : null;

  // 1. Real extraction: with a chat, the memories come from the read, not from the fixture.
  let memories = s.memories, read: unknown = null;
  if (msgs.length && stats) {
    const out = await generateText({
      model, system: SYSTEM, temperature: 0, output: Output.object({ schema: analysisSchema }),
      prompt: buildPrompt({ personName: s.person, relation: "GIRLFRIEND", gender: "FEMALE", notes: null, myName: s.me, theirName: s.person, stats, tzOffsetMin: 0, msgs, budget, now }),
    });
    read = out.output;
    memories = factsFromAnalysis(out.output).map((f, i) => ({ id: `m${i}`, text: f.text, date: f.happenedAt?.toISOString().slice(0, 10), tags: f.entities, triples: f.triples ?? [] }));
  }
  const g = buildScenario({ ...s, categories: undefined, evidence: undefined }, memories);

  // 2. Category step, as the background job does it.
  const todo = needsCategory(g.nodes, g.edges);
  if (todo.length) {
    const { items } = await ask(categoryAnswerSchema, categoryPrompt(todo.map((n) => n.label), g.graph.known()));
    const byKey = items.map((a) => ({ ...a, name: todo.find((n) => n.label.toLowerCase() === a.name.trim().toLowerCase())?.key ?? a.name }));
    const plan = acceptCategories(byKey, todo, g.nodes, g.edges);
    applyMerges(g.nodes, g.edges, plan.merges);
    g.add({ factId: "", triples: plan.triples });
  }

  // 3. Evidence step: the exact line behind each edge, kept here in memory instead of encrypted in a database.
  const quotes = new Map<string, { text: string; ts: number; sender: "them" | "me" }>();
  if (msgs.length) {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const name = (id: string) => (byId.get(id)?.key === "them" ? s.person : byId.get(id)?.key === "me" ? s.me : byId.get(id)?.label ?? "?");
    const text = new Map(memories.map((m) => [m.id, m.text]));
    const items = g.edges.filter((e) => e.factId).flatMap((e) => evidenceItem(e, `${name(e.fromId)} ${e.rel}${e.label ? ` (${e.label})` : ""} ${name(e.toId)}. Memory: "${text.get(e.factId!)}"`, byId, msgs) ?? []);
    if (items.length) {
      const { items: answer } = await ask(evidenceAnswerSchema, evidencePrompt(items.map((it, i) => renderItem(it, i + 1, msgs, 0)), { me: s.me, them: s.person }));
      for (const f of acceptEvidence(answer, items, msgs, s.me)) {
        Object.assign(g.edges.find((e) => e.id === f.edgeId)!, { at: new Date(f.ts), tone: f.tone, polarity: f.polarity, confidence: f.confidence, quoted: true, quoteSender: f.sender });
        quotes.set(f.edgeId, { text: f.text, ts: f.ts, sender: f.sender });
      }
    }
  }

  const facts = memories
    .map((m) => ({ id: m.id, kind: "FACT", text: m.text, happenedAt: m.date ? new Date(m.date) : null, entities: m.tags ?? [] }))
    .sort((a, b) => (a.happenedAt?.getTime() ?? Infinity) - (b.happenedAt?.getTime() ?? Infinity));
  const graph = buildGraph(g.nodes, g.edges, facts, { them: s.person });
  const focus = graph.mentioned(s.focus ?? s.ask).map((n) => n.id);
  const kinds = new Set<string>(graph.tensions(focus, 50, false, now).map((t) => t.kind));
  const missing = s.expect.findings.filter((k) => !kinds.has(k)), unwanted = (s.not ?? []).filter((k) => kinds.has(k));
  if (missing.length || unwanted.length) return { ok: false, why: [missing.length ? `missing finding: ${missing.join(", ")}` : "", unwanted.length ? `unwanted finding: ${unwanted.join(", ")}` : ""].filter(Boolean).join("; ") };

  // 4. The coach, with its real tools over the in-memory graph.
  const voice = msgs.length ? voiceProfile(msgs, s.me) : null;
  const tools = coachTools({
    msgs, tz: 0, knownFacts: facts.map((f) => f.text), saveFact: async () => undefined, facts, graph: { nodes: g.nodes, edges: g.edges }, personName: s.person,
    quote: async (id) => quotes.get(id) ?? null, voice, cap: capFor(budget),
  });
  const context = buildCoachContext({
    personName: s.person, relation: "GIRLFRIEND", gender: "FEMALE", notes: null,
    chat: stats ? { myName: s.me, theirName: s.person, tzOffset: 0, stats, msgs } : null,
    read, facts, graph: graph.brief(graph.mentioned(s.ask).map((n) => n.id)).slice(0, 12_000), known: graph.known(), budget: Math.floor(budget / 2), voice: voice ? voiceForPrompt(voice) : undefined, now,
  });
  const { text } = await generateText({ model, system: `${COACH_SYSTEM}\n\n${context}`, prompt: s.ask, tools, stopWhen: stepCountIs(COACH_STEPS), maxRetries: 1 });
  if (s.expect.quote && !norm(text).includes(norm(s.expect.quote))) return { ok: false, why: `exact quote not cited: "${s.expect.quote}"` };
  return { ok: true, why: "" };
}

const only = process.env.EVAL_ONLY?.split(",").map((x) => x.trim());
const scenarios = loadScenarios().filter((s) => !only || only.includes(s.name));
console.log(`eval: ${provider} ${modelId}, ${scenarios.length} scenarios x ${runs} run${runs === 1 ? "" : "s"}\n`);
let cheese = true, passed = 0, total = 0;
for (const s of scenarios) {
  let ok = 0;
  const reasons = new Set<string>();
  for (let i = 0; i < runs; i++) {
    const r = await runOnce(s).catch((e) => ({ ok: false, why: `error: ${String((e as Error)?.message ?? e).slice(0, 160)}` }));
    if (r.ok) ok++;
    else reasons.add(r.why);
  }
  passed += ok;
  total += runs;
  if (s.name === "cheese-cost" && ok < runs) cheese = false;
  console.log(`${ok === runs ? "PASS" : "FAIL"}  ${s.name.padEnd(24)} ${ok}/${runs}${reasons.size ? `   ${[...reasons].join(" | ")}` : ""}`);
}
console.log(`\n${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`);
// The canonical test: the cheese scenario has to pass.
process.exit(cheese ? 0 : 1);
