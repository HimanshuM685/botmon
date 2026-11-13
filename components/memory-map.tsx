"use client";

import { useMemo } from "react";

export type MapFact = { id: string; kind: string; text: string; entities: string[] };
export type MapLink = { fromId: string; toId: string; kind: string };

const W = 720, H = 460, CX = W / 2, CY = H / 2;
const MAX_HUBS = 12;
const FILL: Record<string, string> = { EVENT: "var(--heart)", FACT: "var(--paper)", PREFERENCE: "var(--mint)", DATE: "var(--amber)" };

/**
 * Lay the memory graph out as a wheel: the person in the middle, the most-shared tags as hubs around them,
 * each memory next to its first hub. Pure so it can be tested; no physics, the shape is stable between visits.
 */
export function layout(facts: MapFact[]) {
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
  return { hubs, nodes, loose: loose.length };
}

export function MemoryMap({ name, facts, links, selected, onSelect }: {
  name: string; facts: MapFact[]; links: MapLink[]; selected: string | null; onSelect: (entity: string | null) => void;
}) {
  const { hubs, nodes, loose } = useMemo(() => layout(facts), [facts]);
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
        {links.map((l, i) => {
          const a = pos.get(l.fromId), b = pos.get(l.toId);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--amber)" strokeOpacity={0.7}><title>{l.kind}</title></line> : null;
        })}
        {nodes.map((n) => (
          <circle key={n.fact.id} cx={n.x} cy={n.y} r={5} fill={FILL[n.fact.kind] ?? "var(--paper)"} opacity={dim(n.fact.entities)}>
            <title>{n.fact.text}</title>
          </circle>
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
            <text x={h.x + Math.cos(h.a) * 4} y={h.y + (Math.sin(h.a) < -0.3 ? -24 : 34)} textAnchor="middle" fontSize={11} fill="var(--muted)">{h.name}</text>
          </g>
        ))}
      </svg>
      <p className="px-4 pb-3 text-xs text-dim">
        Each ring is a person, place or topic; dots are memories. Click a ring to see its memories below.
        {loose > 0 && ` ${loose} ${loose === 1 ? "memory isn't" : "memories aren't"} connected to anything yet.`}
      </p>
    </div>
  );
}
