import "server-only";
import { embedMany } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { db } from "../db";
import { embedModelFor, type ProviderId } from "../ai/models";
import type { Graph, GNode } from "../graph";
import { contentWords, COSINE_MIN } from "./resolve";

/**
 * Embeddings for the graph: node labels only, never chat lines. Stored on MemoryNode with pgvector and compared
 * by exact cosine within one person and one embedding model. Providers that can't embed (Grok, Groq, OpenRouter)
 * simply have no vectors: resolution then stops at spelling (lib/graph/resolve.ts), and everything else is the same.
 * Every call here is best-effort: a failed embedding never fails the write or the reply it was helping.
 */

type Key = { provider: ProviderId; apiKey: string };


/**
 * Embed short texts with the user's key. Null when the provider can't, or the call failed.
 * NIM is called directly: its embedding models take an `input_type` the SDK doesn't send.
 * `dims`: fewer numbers per vector where the model allows it (Gemini, OpenAI); `strict`: throw instead of null, so a
 * background job can tell a rate limit from a broken key.
 */
export async function embed(key: Key, values: string[], opts: { dims?: number; strict?: boolean } = {}): Promise<number[][] | null> {
  const model = embedModelFor(key.provider);
  if (!model || !values.length) return null;
  try {
    if (key.provider === "NIM") {
      const res = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
        method: "POST",
        headers: { authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
        // One input_type for labels and for looked-up words: they must land in the same space.
        body: JSON.stringify({ model, input: values, input_type: "passage", encoding_format: "float" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    const { embeddings } = await embedMany({
      model: key.provider === "GEMINI" ? createGoogle({ apiKey: key.apiKey }).embedding(model) : createOpenAI({ apiKey: key.apiKey }).embedding(model),
      values,
      maxRetries: 1,
      // Gemini's default is 3072 numbers a label; 768 is plenty for names.
      ...(key.provider === "GEMINI" ? { providerOptions: { google: { outputDimensionality: opts.dims ?? 768 } } } : {}),
      ...(key.provider === "OPENAI" && opts.dims ? { providerOptions: { openai: { dimensions: opts.dims } } } : {}),
    });
    return embeddings;
  } catch (e) {
    if (opts.strict) throw e;
    console.error("embedding failed", key.provider, (e as Error)?.message);
    return null;
  }
}

const literal = (v: number[]) => `[${v.join(",")}]`;

/** For each vector, the person's closest node of the same embedding model, when it is close enough. */
export async function nearestNodes(personId: string, model: string, vectors: number[][], min = COSINE_MIN): Promise<(string | null)[]> {
  return Promise.all(
    vectors.map(async (v) => {
      const rows = await db.$queryRaw<{ id: string; score: number }[]>`
        SELECT "id", 1 - ("embedding" <=> ${literal(v)}::vector) AS score FROM "MemoryNode"
        WHERE "personId" = ${personId} AND "embedModel" = ${model} AND "embedding" IS NOT NULL AND "kind" NOT IN ('them', 'me')
        ORDER BY "embedding" <=> ${literal(v)}::vector LIMIT 1`;
      return rows[0] && Number(rows[0].score) >= min ? rows[0].id : null;
    }),
  );
}

export async function storeEmbeddings(personId: string, model: string, rows: { id: string; vector: number[] }[]) {
  if (!rows.length) return;
  // One statement, not a transaction of one per row: a hundred round trips outlast the transaction timeout.
  await db.$executeRaw`UPDATE "MemoryNode" AS n SET "embedding" = v.vec::vector, "embedModel" = ${model}
    FROM unnest(${rows.map((r) => r.id)}::text[], ${rows.map((r) => literal(r.vector))}::text[]) AS v(id, vec)
    WHERE n."id" = v.id AND n."personId" = ${personId}`;
}

/**
 * Before new nodes are created: which of them an existing node already means ("curd" when there is "dahi").
 * Returns the matches (node key -> existing node id) and the vectors of the rest, to store once they exist.
 */
export async function resolveByMeaning(personId: string, key: Key | undefined, fresh: GNode[]) {
  const model = key && embedModelFor(key.provider);
  const none = { same: new Map<string, string>(), vectors: new Map<string, number[]>(), model: null as string | null };
  if (!key || !model || !fresh.length) return none;
  const vectors = await embed(key, fresh.map((n) => n.label));
  if (!vectors) return none;
  const hits = await nearestNodes(personId, model, vectors).catch(() => vectors.map(() => null));
  const out = { ...none, model };
  fresh.forEach((n, i) => (hits[i] ? out.same.set(n.key, hits[i]!) : out.vectors.set(n.key, vectors[i])));
  return out;
}

/** Background: nodes that have no embedding of this provider's model yet get one. */
export async function embedMissing(personId: string, key: Key, batch = 100) {
  const model = embedModelFor(key.provider);
  if (!model) return;
  const todo = await db.memoryNode.findMany({ where: { personId, kind: { notIn: ["them", "me"] }, OR: [{ embedModel: null }, { embedModel: { not: model } }] }, take: batch, select: { id: true, label: true } });
  const vectors = await embed(key, todo.map((n) => n.label));
  if (vectors) await storeEmbeddings(personId, model, todo.map((n, i) => ({ id: n.id, vector: vectors[i] })));
}

/**
 * What a message is about: the nodes it names (lib/graph.ts mentioned), plus the ones its other words mean.
 * Only those words are embedded, and only when the graph has vectors of this provider's model.
 */
export async function focusNodes(graph: Graph, personId: string, key: Key, text: string): Promise<GNode[]> {
  const named = graph.mentioned(text);
  const model = embedModelFor(key.provider);
  if (!model || !graph.nodes.some((n) => n.embedModel === model)) return named;
  const words = contentWords(text, named.flatMap((n) => [n.key, ...n.aliases]));
  const vectors = await embed(key, words);
  if (!vectors) return named;
  const ids = new Set((await nearestNodes(personId, model, vectors).catch(() => [])).filter(Boolean));
  return [...named, ...graph.nodes.filter((n) => ids.has(n.id) && !named.includes(n))];
}
