"use client";

import { useMemo, useState } from "react";

export type MapFact = { id: string; kind: string; text: string; entities: string[]; feeling?: string | null; valence?: number | null };
export type MapLink = { fromId: string; toId: string; kind: string };
/** A graph edge between two topics (node keys), e.g. cheese IS_A milk product. */
export type MapRelation = { from: string; to: string; rel: string };

/** A typed edge from the person (or the user) to a topic: "them AVOIDS milk (allergic)", with how and when it was said. */
export type MapEdge = { id: string; from: string; to: string; rel: string; label: string | null; tone: string | null; at: string | null; quoted: boolean };
/** A stored finding (lib/graph/findings.ts) and the edges it rests on. */
export type MapFinding = { kind: string; text: string; edgeIds: string[] };

const W = 720, H = 460, CX = W / 2, CY = H / 2;
const MAX_HUBS = 12;
const FILL: Record<string, string> = { EVENT: "var(--heart)", FACT: "var(--paper)", PREFERENCE: "var(--mint)", DATE: "var(--amber)" };

/** What a link says about how they stand towards the thing: liking, aversion, something done, or neutral. */
const REL_COLOR: Record<string, string> = { LIKES: "var(--mint)", WANTS: "var(--mint)", DISLIKES: "var(--amber)", AVOIDS: "var(--heart)", FEARS: "var(--heart)", DID_FOR: "var(--paper)" };
/** How it was said, when the chat line is known: warm tones green, guarded ones amber. Overrides the link's own colour. */
const TONE_COLOR: Record<string, string> = { warm: "var(--mint)", sincere: "var(--mint)", playful: "var(--paper)", teasing: "var(--paper)", reluctant: "var(--amber)", sarcastic: "var(--amber)", cold: "var(--amber)", annoyed: "var(--amber)" };
export const edgeColor = (e: { rel: string; tone: string | null }) => (e.tone && TONE_COLOR[e.tone]) || REL_COLOR[e.rel] || "var(--muted)";
const MAX_MARKS = 4;

/**
 * Lay the memory graph out as a wheel: the person in the middle, the most-shared tags as hubs around them,
 * each memory next to its first hub. Pure so it can be tested; no physics, the shape is stable between visits.
 */
export function layout(facts: MapFact[], edges: MapEdge[] = [], findings: MapFinding[] = []) {
  const count = new Map<string, number>();
  for (const f of facts) for (const e of f.entities) count.set(e, (count.get(e) ?? 0) + 1);
  const names = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_HUBS).map(([e]) => e);
  const hubs = names.map((name, i) => {
    const a = (i / names.length) * 2 * Math.PI - Math.PI / 2;
    return { name, n: count.get(name)!, a, x: CX + Math.cos(a) * 150, y: CY + Math.sin(a) * 140 };
  });
  const at = new Map(hubs.map((h) => [h.name, h]));
  const members = new Map<string, MapFact[]>();
  const loose: MapFact[] = [];
  for (const f of facts) {
    const home = f.entities.find((e) => at.has(e));
    if (home) members.set(home, [...(members.get(home) ?? []), f]);
    else loose.push(f);
  }
  const nodes = hubs.flatMap((h) =>
    (members.get(h.name) ?? []).map((f, i, all) => {
      // Fan the hub's memories out on the side facing away from the centre.
      const a = h.a + (i - (all.length - 1) / 2) * Math.min(0.5, 2.4 / all.length);
      const r = 46 + (i % 2) * 16;
      return { fact: f, x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r, home: h.name, also: f.entities.filter((e) => e !== h.name && at.has(e)) };
    }),
  );
  // Typed edges between the person (or the user) and a topic sit as marks on that topic's spoke, nearest the centre first.
  const perHub = new Map<string, MapEdge[]>();
  for (const e of edges) {
    const topic = at.has(e.to) && (e.from === "them" || e.from === "me") ? e.to : at.has(e.from) && (e.to === "them" || e.to === "me") ? e.from : null;
    if (topic) perHub.set(topic, [...(perHub.get(topic) ?? []), e]);
  }
  const marks = [...perHub.entries()].flatMap(([name, list]) =>
    list.slice(-MAX_MARKS).map((edge, i) => {
      const h = at.get(name)!, f = 0.42 + i * 0.13;
      return { edge, hub: name, x: CX + (h.x - CX) * f, y: CY + (h.y - CY) * f };
    }),
  );
  // A finding flags the topics its evidence is about.
  const byId = new Map(edges.map((e) => [e.id, e]));
  const flags = new Map<string, MapFinding[]>();
  for (const f of findings)
    for (const name of new Set(f.edgeIds.flatMap((id) => [byId.get(id)?.from, byId.get(id)?.to]).filter((k): k is string => !!k && at.has(k))))
      flags.set(name, [...(flags.get(name) ?? []), f]);
  return { hubs, nodes, loose: loose.length, marks, flags };
}

export function MemoryMap({ name, facts, links, relations = [], edges = [], findings = [], loadQuote, selected, onSelect }: {
  name: string; facts: MapFact[]; links: MapLink[]; relations?: MapRelation[]; edges?: MapEdge[]; findings?: MapFinding[]; selected: string | null; onSelect: (entity: string | null) => void;
  /** Fetches the chat line behind an edge (a server action; passed in so this file stays free of server imports). */
  loadQuote?: (edgeId: string) => Promise<{ text: string; date: string; by: string } | null>;
}) {
  const { hubs, nodes, loose, marks, flags } = useMemo(() => layout(facts, edges, findings), [facts, edges, findings]);
  // The link whose detail is open below the map, and its chat line once fetched (decrypted on the server, on demand).
  const [open, setOpen] = useState<MapEdge | null>(null);
  const [quote, setQuote] = useState<{ id: string; text: string; date: string; by: string } | "loading" | null>(null);
  const show = async (e: MapEdge) => {
    setOpen(open?.id === e.id ? null : e);
    setQuote(null);
    if (open?.id === e.id || !e.quoted) return;
    setQuote("loading");
    const q = (await loadQuote?.(e.id).catch(() => null)) ?? null;
    setQuote(q ? { id: e.id, ...q } : null);
  };
  const who = (k: string) => (k === "them" ? name.split(" ")[0] : k === "me" ? "You" : k);
  if (!hubs.length)
    return <p className="card p-8 text-center text-sm text-muted">No connections yet. They appear as reads and the coach tag what each memory is about, or add an &ldquo;About&rdquo; tag yourself.</p>;
  const hub = new Map(hubs.map((h) => [h.name, h]));
  const pos = new Map(nodes.map((n) => [n.fact.id, n]));
  const dim = (entities: string[]) => (selected && !entities.includes(selected) ? 0.2 : 1);

  return (
    <div className="card overflow-hidden p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Map of what is known about ${name}: ${hubs.length} topics, ${nodes.length} connected memories`}>
        {hubs.map((h) => <line key={h.name} x1={CX} y1={CY} x2={h.x} y2={h.y} stroke="var(--line)" opacity={dim([h.name])} />)}
        {nodes.map((n) => (
          <g key={n.fact.id} opacity={dim(n.fact.entities)}>
            <line x1={hub.get(n.home)!.x} y1={hub.get(n.home)!.y} x2={n.x} y2={n.y} stroke="var(--line)" />
            {/* A memory about two topics ties their hubs together. */}
            {n.also.map((e) => <line key={e} x1={n.x} y1={n.y} x2={hub.get(e)!.x} y2={hub.get(e)!.y} stroke="var(--heart)" strokeOpacity={0.35} strokeDasharray="3 4" />)}
          </g>
        ))}
        {/* Topics that belong together in the graph (cheese IS_A milk product). */}
        {relations.map((r, i) => {
          const a = hub.get(r.from), b = hub.get(r.to);
          return a && b ? <line key={`r${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--mint)" strokeOpacity={0.6} strokeWidth={1.5} opacity={dim([r.from, r.to])}><title>{`${r.from} ${r.rel} ${r.to}`}</title></line> : null;
        })}
        {links.map((l, i) => {
          const a = pos.get(l.fromId), b = pos.get(l.toId);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--amber)" strokeOpacity={0.7}><title>{l.kind}</title></line> : null;
        })}
        {nodes.map((n) => (
          <circle key={n.fact.id} cx={n.x} cy={n.y} r={5} fill={FILL[n.fact.kind] ?? "var(--paper)"} opacity={dim(n.fact.entities)}
            // A ring shows how it landed for them: mint good, amber bad.
            stroke={n.fact.valence ? (n.fact.valence > 0 ? "var(--mint)" : "var(--amber)") : undefined} strokeWidth={2} paintOrder="stroke">
            <title>{n.fact.feeling ? `${n.fact.text} (felt ${n.fact.feeling})` : n.fact.text}</title>
          </circle>
        ))}
        {/* Typed links from the person to a topic: coloured by what they say and how it was said; ringed when a chat line is stored. */}
        {marks.map((m) => (
          <g key={m.edge.id} role="button" tabIndex={0} className="cursor-pointer outline-none" opacity={dim([m.hub])}
            aria-label={`${who(m.edge.from)} ${m.edge.rel} ${who(m.edge.to)}${m.edge.quoted ? ", show what was said" : ""}`} aria-pressed={open?.id === m.edge.id}
            onClick={() => show(m.edge)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), show(m.edge))}>
            <circle cx={m.x} cy={m.y} r={open?.id === m.edge.id ? 6 : 4.5} fill={edgeColor(m.edge)} stroke={m.edge.quoted ? "var(--paper)" : "var(--ink)"} strokeWidth={1.5} />
            <title>{`${who(m.edge.from)} ${m.edge.rel}${m.edge.label ? ` (${m.edge.label})` : ""} ${who(m.edge.to)}${m.edge.tone ? `, said ${m.edge.tone}` : ""}${m.edge.at ? `, ${m.edge.at}` : ""}`}</title>
          </g>
        ))}
        <circle cx={CX} cy={CY} r={30} fill="var(--heart)" />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">{name.split(" ")[0].slice(0, 9)}</text>
        {hubs.map((h) => (
          <g
            key={h.name} role="button" tabIndex={0} aria-pressed={selected === h.name} aria-label={`${h.name}, ${h.n} memories`} className="cursor-pointer outline-none"
            opacity={dim([h.name])}
            onClick={() => onSelect(selected === h.name ? null : h.name)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(selected === h.name ? null : h.name))}
          >
            <circle cx={h.x} cy={h.y} r={10 + Math.min(8, h.n * 2)} fill="var(--ink-3)" stroke={selected === h.name ? "var(--heart)" : "var(--line)"} strokeWidth={selected === h.name ? 2 : 1} />
            <text x={h.x} y={h.y + 3.5} textAnchor="middle" fontSize={10} fill="var(--paper)">{h.n}</text>
            {flags.has(h.name) && (
              <g>
                <circle cx={h.x + 12} cy={h.y - 12} r={7} fill="var(--amber)" />
                <text x={h.x + 12} y={h.y - 8.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--ink)">!</text>
                <title>{flags.get(h.name)!.map((f) => f.text).join("\n\n")}</title>
              </g>
            )}
            <text x={h.x + Math.cos(h.a) * 4} y={h.y + (Math.sin(h.a) < -0.3 ? -24 : 34)} textAnchor="middle" fontSize={11} fill="var(--muted)">{h.name}</text>
          </g>
        ))}
      </svg>
      {open && (
        <div className="mx-4 mb-3 rounded-xl border border-line p-3 text-sm" aria-live="polite">
          <p>
            <span style={{ color: edgeColor(open) }}>●</span> {who(open.from)} {open.rel.toLowerCase().replace("_", " ")}{open.label ? ` (${open.label})` : ""} {who(open.to)}
            {open.tone && <span className="text-muted"> · said {open.tone}</span>}{open.at && <span className="text-muted"> · {open.at}</span>}
          </p>
          {quote === "loading" ? <p className="mt-1 text-xs text-dim">Finding what was said…</p>
            : quote && quote.id === open.id ? <blockquote className="mt-2 border-l-2 border-heart pl-3 text-muted">&ldquo;{quote.text}&rdquo;<footer className="mt-1 text-xs text-dim">{quote.by}, {quote.date}</footer></blockquote>
            : <p className="mt-1 text-xs text-dim">{open.quoted ? "The line is no longer available." : "No chat line is stored for this yet."}</p>}
        </div>
      )}
      {selected && flags.has(selected) && (
        <ul className="mx-4 mb-3 space-y-1 text-xs text-amber">
          {flags.get(selected)!.map((f, i) => <li key={i}>! {f.text}</li>)}
        </ul>
      )}
      <p className="px-4 pb-3 text-xs text-dim">
        Each ring is a person, place or topic; dots are memories, outlined green where it felt good for them and amber where it felt bad. Small dots on a spoke are what links them to that topic (green a liking or warm, red what they avoid or fear, amber a dislike or a guarded tone); a white ring means the exact line is stored: click it to read it. A &ldquo;!&rdquo; marks a finding. Click a ring to see its memories below.
        {loose > 0 && ` ${loose} ${loose === 1 ? "memory isn't" : "memories aren't"} connected to anything yet.`}
      </p>
    </div>
  );
}
