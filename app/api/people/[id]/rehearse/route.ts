import { createIdGenerator, createUIMessageStream, createUIMessageStreamResponse, generateText } from "ai";
import { db } from "@/lib/db";
import { getChat, getChatStats, loadChat } from "@/lib/data";
import { Prisma } from "@/generated/prisma/client";
import { getModel, providerError } from "@/lib/ai/provider";
import { CHAR_BUDGET } from "@/lib/ai/models";
import { beginTurn } from "@/lib/ai/turn";
import { buildGraph, THEM } from "@/lib/graph";
import { loadGraphRows } from "@/lib/graph-store";
import { focusNodes } from "@/lib/graph/vectors";
import { enoughMemory } from "@/lib/model";
import { buildPersonaContext, personaSystem, personaTurns } from "@/lib/ai/persona";
import type { RelationId } from "@/lib/ai/prompt";
import { applyVoice, voiceForPrompt, voiceProfile } from "@/lib/voice";

export const maxDuration = 60;
/** Turns of the rehearsal sent back to the model. */
const TURNS = 40;
const newId = createIdGenerator({ prefix: "msg", size: 16 });

/**
 * Rehearsal: the user practises with a simulation of the person. The reply is generated with NO tools and nothing
 * here writes memories, edges or findings: simulated words must never become facts about the real person.
 * Threads are stored with mode "rehearsal", which keeps them out of the coach's list and its history search.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = await beginTurn(req, (await params).id, {
    mode: "rehearsal",
    gate: async (person) => {
      const [chat, factCount] = await Promise.all([getChat(person.id), db.personFact.count({ where: { personId: person.id, deletedAt: null } })]);
      // Without a chat there must at least be enough told about them, or the simulation would be pure invention.
      if (!chat && !enoughMemory(factCount, person.notes))
        return Response.json({ error: `Not enough is known about ${person.name} to practise with yet. Upload a chat, or tell the coach more about them first.` }, { status: 400 });
      return null;
    },
  });
  if (started instanceof Response) return started;
  const { person, key, thread, message } = started;

  const [rows, read, facts, graphRows, chat] = await Promise.all([
    db.coachMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, take: TURNS }),
    db.analysis.findFirst({ where: { personId: person.id, deletedAt: null, result: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { result: true } }),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: null }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }], select: { id: true, kind: true, text: true, happenedAt: true, feeling: true, valence: true } }),
    loadGraphRows(person.id),
    getChat(person.id),
  ]);
  const said = message.parts.map((p) => p.text).join(" ");
  const msgs = chat ? await loadChat(chat.cipher) : [];
  // Their voice, measured from their own messages: the prompt asks for it, applyVoice below holds the reply to it.
  const theirVoice = chat ? voiceProfile(msgs, chat.theirName) : null;
  // Grounding, rebuilt every turn: the graph around what was just said, their boundaries, the read, real exchanges.
  const graph = buildGraph(graphRows.nodes, graphRows.edges, facts, { them: person.name });
  const them = graph.nodes.find((n) => n.key === THEM);
  // Same "what is this about" as the coach: spelling, then embeddings when this key can embed.
  const focus = await focusNodes(graph, person.id, key, said);
  const context = buildPersonaContext({
    personName: person.name,
    relation: person.relation as RelationId,
    gender: person.gender,
    chat: chat ? { myName: chat.myName, theirName: chat.theirName, tzOffset: chat.tzOffset, stats: await getChatStats(chat), msgs } : null,
    read: (read?.result ?? null) as Record<string, unknown> | null,
    graph: graph.brief(focus.map((n) => n.id)).slice(0, 8_000),
    boundaries: graph.edges.filter((e) => e.fromId === them?.id && ["AVOIDS", "FEARS", "DISLIKES"].includes(e.rel)).slice(-30).map((e) => graph.renderEdge(e)),
    voice: theirVoice ? voiceForPrompt(theirVoice, "them") : undefined,
    said,
    budget: CHAR_BUDGET[key.provider],
  });

  let text: string;
  try {
    const out = await generateText({
      model: getModel(key.provider, key.apiKey, key.model),
      system: `${personaSystem(person.name)}\n\n${context}`,
      messages: personaTurns(rows.reverse()),
      maxRetries: 1,
    });
    text = applyVoice(out.text.trim(), theirVoice) || out.text.trim();
  } catch (e) {
    console.error("rehearse failed", key.provider, key.model, (e as Error)?.message);
    return Response.json({ error: providerError(e), threadId: thread.id }, { status: 502, headers: { "x-thread-id": thread.id } });
  }
  if (!text) return Response.json({ error: "The model returned nothing", threadId: thread.id }, { status: 502, headers: { "x-thread-id": thread.id } });

  const reply = { id: newId(), parts: [{ type: "text" as const, text }] };
  await db.$transaction([
    db.coachMessage.create({ data: { id: reply.id, threadId: thread.id, role: "assistant", parts: reply.parts } }),
    db.coachThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } }),
  ]);

  // Sent whole, not streamed: the reply is corrected to their typing first, and it is a text message, not an essay.
  return createUIMessageStreamResponse({
    headers: { "x-thread-id": thread.id },
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: reply.id });
        writer.write({ type: "text-start", id: "t" });
        writer.write({ type: "text-delta", id: "t", delta: text });
        writer.write({ type: "text-end", id: "t" });
        writer.write({ type: "finish" });
      },
    }),
  });
}
