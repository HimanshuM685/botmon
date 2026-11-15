"use server";

import { generateText } from "ai";
import { factsFromAnalysis, newFacts, toEntities, toFeeling, toValence } from "@/lib/facts";
import { pruneGraph, retagMemory, saveMemories, syncGraph } from "@/lib/graph-store";
import { scheduleGraphJob } from "@/lib/graph/job";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { MAX_PEOPLE, getActiveKey, getPerson } from "@/lib/data";
import { alive } from "@/lib/trash";
import { MODELS_URL, parseModelList, PROVIDER_IDS, type ProviderId } from "@/lib/ai/models";
import { getModel, providerError } from "@/lib/ai/provider";
import { RELATIONS } from "@/lib/ai/prompt";
import type { Analysis } from "@/lib/ai/schema";

export type ActionState = { error?: string; ok?: boolean } | undefined;

const personSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  relation: z.enum(Object.keys(RELATIONS) as [keyof typeof RELATIONS, ...(keyof typeof RELATIONS)[]]),
  gender: z.enum(["FEMALE", "MALE", "OTHER"]),
  notes: z.string().trim().max(1000).optional().transform((s) => s || null),
});

export async function savePerson(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = personSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const id = form.get("id")?.toString();

  if (id) {
    if (!(await getPerson(user.id, id))) return { error: "Not found" };
    await db.person.update({ where: { id }, data: parsed.data });
    revalidatePath(`/people/${id}`);
    return { ok: true };
  }
  // ponytail: count-then-insert can race to 4 on double submit; add a DB trigger if that ever matters
  if ((await db.person.count({ where: { userId: user.id, ...alive } })) >= MAX_PEOPLE)
    return { error: `You can track up to ${MAX_PEOPLE} people.` };
  const person = await db.person.create({ data: { ...parsed.data, userId: user.id } });
  redirect(`/people/${person.id}`);
}

export async function deletePerson(id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await db.person.updateMany({ where: { id, userId: user.id, ...alive }, data: { deletedAt: new Date() } });
  if (!res.count) return { error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true }; // the client navigates (components/delete-person-button.tsx)
}

const providerSchema = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

const keySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(10, "That key looks too short").max(500),
  model: z.string().trim().min(1).max(120),
});

/**
 * The chat models a key can use, asked from the provider itself. Goes through the server because most providers
 * don't allow this call from a browser. The key is used for this one request and not stored or logged here.
 */
export async function listModels(providerInput: string, apiKeyInput: string): Promise<{ models?: string[]; error?: string }> {
  await requireUser();
  const parsed = keySchema.omit({ model: true }).safeParse({ provider: providerInput, apiKey: apiKeyInput });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { provider, apiKey } = parsed.data;
  try {
    const res = await fetch(MODELS_URL[provider], {
      headers: provider === "GEMINI" ? { "x-goog-api-key": apiKey } : { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return { error: providerError({ statusCode: res.status, message: `HTTP ${res.status}` }) };
    const models = parseModelList(provider, await res.json());
    return models.length ? { models } : { error: "This key has no chat models available." };
  } catch {
    return { error: "Couldn't reach the provider to list models. You can still type a model name." };
  }
}

export async function saveKey(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = keySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { provider, apiKey, model } = parsed.data;

  try {
    await generateText({ model: getModel(provider, apiKey, model), prompt: "Reply with OK.", maxOutputTokens: 16, maxRetries: 0 });
  } catch (e) {
    return { error: providerError(e) };
  }

  const data = { model, cipher: encrypt(apiKey), last4: apiKey.slice(-4) };
  await db.apiKey.upsert({
    where: { userId_provider: { userId: user.id, provider } },
    create: { ...data, provider, userId: user.id },
    update: data,
  });
  await db.user.update({ where: { id: user.id }, data: { defaultProvider: provider } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteKey(input: ProviderId) {
  const user = await requireUser();
  const provider = providerSchema.safeParse(input);
  if (!provider.success) return;
  await db.apiKey.deleteMany({ where: { userId: user.id, provider: provider.data } });
  // Keep defaultProvider pointing at a key that exists (or nothing).
  const me = await db.user.findUnique({ where: { id: user.id }, select: { defaultProvider: true } });
  if (me?.defaultProvider === provider.data) {
    const next = await db.apiKey.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { provider: true } });
    await db.user.update({ where: { id: user.id }, data: { defaultProvider: next?.provider ?? null } });
  }
  revalidatePath("/settings");
}

export async function setDefaultProvider(input: ProviderId) {
  const user = await requireUser();
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return;
  const provider = parsed.data;
  if (!(await db.apiKey.findFirst({ where: { userId: user.id, provider } }))) return;
  await db.user.update({ where: { id: user.id }, data: { defaultProvider: provider } });
  revalidatePath("/settings");
}

export async function deleteAccount(): Promise<ActionState> {
  const user = await requireUser();
  // 30-day grace: hide everything now; lib/purge.ts erases the account (app data + Neon Auth identity) later.
  // AI keys are secrets, not user data: they go immediately, as the privacy page promises.
  await db.$transaction([
    db.apiKey.deleteMany({ where: { userId: user.id } }),
    db.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), defaultProvider: null } }),
  ]);
  // End the session on the server too, so the account is signed out even if the client step never runs.
  await auth.signOut();
  return { ok: true }; // the client then clears its cached session cookie and reloads (signOutAndReload)
}

/* ---------- 30-day trash ---------- */

export async function restoreAccount() {
  const { data } = await auth.getSession();
  if (!data?.user) redirect("/");
  await db.user.update({ where: { id: data.user.id }, data: { deletedAt: null } });
  redirect("/dashboard");
}

const trashKind = z.enum(["person", "chat", "analysis", "thread", "fact"]);
type TrashKind = z.infer<typeof trashKind>;

// Child rows all share { id, personId, deletedAt } and belong to a person, so one code path handles them.
type ChildDelegate = {
  findFirst(args: { where: object; select: { personId: true; person: { select: { deletedAt: true } } } }): Promise<{ personId: string; person: { deletedAt: Date | null } } | null>;
  update(args: { where: { id: string }; data: { deletedAt: Date | null } }): Promise<unknown>;
};
const children = {
  chat: db.chatUpload,
  analysis: db.analysis,
  thread: db.coachThread,
  fact: db.personFact,
} as unknown as Record<Exclude<TrashKind, "person">, ChildDelegate>;

/** Owner-checked lookup of any trashable row; returns its person. */
async function ownedItem(userId: string, kind: TrashKind, id: string) {
  if (kind === "person") {
    const p = await db.person.findFirst({ where: { id, userId, deletedAt: undefined } }); // live or trashed
    return p && { personId: p.id, personDeleted: !!p.deletedAt };
  }
  const r = await children[kind].findFirst({ where: { id, person: { userId }, deletedAt: undefined }, select: { personId: true, person: { select: { deletedAt: true } } } });
  return r && { personId: r.personId, personDeleted: !!r.person.deletedAt };
}

function setDeleted(kind: TrashKind, id: string, deletedAt: Date | null) {
  const args = { where: { id }, data: { deletedAt } };
  return kind === "person" ? db.person.update(args) : children[kind].update(args);
}

/** Move one item to the trash. People use deletePerson. */
export async function trashItem(kindInput: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const kind = trashKind.safeParse(kindInput);
  if (!kind.success) return { error: "Unknown item" };
  const item = await ownedItem(user.id, kind.data, id);
  if (!item) return { error: "Not found" };
  await setDeleted(kind.data, id, new Date());
  // A memory left: what it had overtaken counts again, and what rested on it is gone.
  if (kind.data === "fact") await syncGraph({ id: item.personId });
  revalidatePath(`/people/${item.personId}`, "layout");
  revalidatePath("/trash");
  return { ok: true };
}

export async function restoreItem(kindInput: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const kind = trashKind.safeParse(kindInput);
  if (!kind.success) return { error: "Unknown item" };
  const item = await ownedItem(user.id, kind.data, id);
  if (!item) return { error: "Not found" };

  // Restoring something inside a deleted person brings the person back too.
  if (item.personDeleted) {
    if ((await db.person.count({ where: { userId: user.id, ...alive } })) >= MAX_PEOPLE)
      return { error: `You already track ${MAX_PEOPLE} people. Delete one first to restore this.` };
    await db.person.update({ where: { id: item.personId }, data: { deletedAt: null } });
  }
  if (kind.data === "chat") {
    // Only one live chat per person: restoring an old chat sends the current one to the trash, and remembers it.
    const [back, current, person] = await Promise.all([
      db.chatUpload.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } }),
      db.chatUpload.findFirst({ where: { personId: item.personId, deletedAt: null, NOT: { id } }, select: { id: true, replacedId: true } }),
      db.person.findUniqueOrThrow({ where: { id: item.personId }, select: { id: true, name: true } }),
    ]);
    // Removed as a wrong chat earlier: the reads that went with it at the same moment return with it.
    const again = back.deletedAt ? await reattachChat(id, item.personId, back.deletedAt) : { queries: [], reads: [] };
    await db.$transaction([
      db.chatUpload.updateMany({ where: { personId: item.personId, deletedAt: null, NOT: { id } }, data: { deletedAt: new Date() } }),
      // If the current chat is the one that replaced this one, restoring is undoing that upload: this chat keeps what
      // it replaced itself. Pointing the two at each other would make each removal bring the other back, forever.
      db.chatUpload.update({ where: { id }, data: { deletedAt: null, ...(current?.replacedId === id ? {} : { replacedId: current?.id ?? null }) } }),
      ...again.queries,
    ]);
    await rebuildMemories(person, again.reads);
  } else if (kind.data !== "person") await setDeleted(kind.data, id, null);
  if (kind.data === "fact") await syncGraph({ id: item.personId });

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- Wrong chat: remove it or move it to the right person ---------- */

type OwnedChat = { id: string; personId: string; createdAt: Date; replacedId: string | null };

function ownedChat(userId: string, chatId: string): Promise<OwnedChat | null> {
  return db.chatUpload.findFirst({ where: { id: chatId, ...alive, person: { userId, ...alive } }, select: { id: true, personId: true, createdAt: true, replacedId: true } });
}

/**
 * The reverse of detachChat, for a chat coming back to a person (moved back, or restored from the trash):
 * the reads made from it there return. Only what detachChat trashed together, recognised by its shared
 * timestamp `at`; reads the user deleted one by one stay deleted.
 * Their memories were erased by detachChat, so the caller rebuilds them from the returned reads (rebuildMemories).
 * ponytail: without `at` (a move back) the latest trashed batch is taken; if the chat left with no live reads,
 * that can be one read the user deleted by hand. Store a detach stamp on the chat if that ever matters.
 */
async function reattachChat(chatId: string, personId: string, at?: Date) {
  const stamp = at ?? (await db.analysis.findFirst({ where: { chatId, personId, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, select: { deletedAt: true } }))?.deletedAt;
  if (!stamp) return { queries: [], reads: [] as string[] };
  const reads = (await db.analysis.findMany({ where: { chatId, personId, deletedAt: stamp }, select: { id: true } })).map((r) => r.id);
  return { queries: reads.length ? [db.analysis.updateMany({ where: { id: { in: reads } }, data: { deletedAt: null } })] : [], reads };
}

/**
 * Put back the memories of reads that just returned: taken again from what each read found (oldest read first),
 * skipping anything already on the timeline or deleted by the user, and tied into the graph.
 */
async function rebuildMemories(person: { id: string; name: string }, readIds: string[]) {
  if (!readIds.length) return;
  const [reads, existing] = await Promise.all([
    db.analysis.findMany({ where: { id: { in: readIds }, deletedAt: undefined }, orderBy: { createdAt: "asc" }, select: { id: true, result: true } }),
    db.personFact.findMany({ where: { personId: person.id, deletedAt: undefined }, select: { text: true } }),
  ]);
  const known = existing.map((f) => f.text);
  for (const r of reads) {
    if (!r.result) continue;
    const fresh = newFacts(known, factsFromAnalysis(r.result as unknown as Analysis));
    await saveMemories(person, fresh, { source: "ANALYSIS", analysisId: r.id });
    known.push(...fresh.map((f) => f.text));
  }
}

/**
 * Undo what a chat left on its person: trash the reads made from it, erase the memories they extracted,
 * and bring back the chat it replaced.
 * The memories are erased, not trashed: a trashed memory means "the user says this is no longer true"
 * (model updates tell the AI so, and re-reads never add it back), which is wrong for facts about someone else.
 * A read still streaming is handled on its side: it re-checks the chat before saving anything (analyze route).
 */
async function detachChat(chat: OwnedChat, now: Date) {
  // Every read of this chat on this person, deleted ones too: deleting a read keeps its memories on the timeline,
  // and those are just as wrong here.
  const reads = (await db.analysis.findMany({ where: { chatId: chat.id, personId: chat.personId, deletedAt: undefined }, select: { id: true } })).map((r) => r.id);
  return [
    db.analysis.updateMany({ where: { id: { in: reads }, deletedAt: null }, data: { deletedAt: now } }),
    db.personFact.deleteMany({ where: { personId: chat.personId, source: "ANALYSIS", analysisId: { in: reads } } }),
    ...(chat.replacedId ? [db.chatUpload.updateMany({ where: { id: chat.replacedId, personId: chat.personId, deletedAt: { not: null } }, data: { deletedAt: null } })] : []),
    // Nothing on this person may keep pointing at the chat that left, or removing that one later would bring this one back.
    db.chatUpload.updateMany({ where: { personId: chat.personId, replacedId: chat.id }, data: { replacedId: null } }),
  ];
}

export async function removeChat(chatId: string): Promise<ActionState> {
  const user = await requireUser();
  const chat = await ownedChat(user.id, chatId);
  if (!chat) return { error: "Not found" };
  const now = new Date();
  await db.$transaction([db.chatUpload.update({ where: { id: chat.id }, data: { deletedAt: now } }), ...(await detachChat(chat, now))]);
  // The erased memories' people and topics leave the graph too.
  await pruneGraph(chat.personId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function moveChat(chatId: string, toPersonId: string): Promise<ActionState> {
  const user = await requireUser();
  const [chat, to] = await Promise.all([ownedChat(user.id, chatId), getPerson(user.id, toPersonId)]);
  if (!chat || !to || to.id === chat.personId) return { error: "Not found" };
  const now = new Date();
  const theirs = await db.chatUpload.findFirst({ where: { personId: to.id, deletedAt: null }, select: { id: true } });
  // Moved back to a person it was on before: the reads made from it there return, and their memories are rebuilt.
  const again = await reattachChat(chat.id, to.id);
  await db.$transaction([
    ...(await detachChat(chat, now)),
    db.chatUpload.updateMany({ where: { personId: to.id, deletedAt: null }, data: { deletedAt: now } }),
    // Removing it from the new person brings back the chat it replaced there.
    db.chatUpload.update({ where: { id: chat.id }, data: { personId: to.id, replacedId: theirs?.id ?? null } }),
    ...again.queries,
  ]);
  await Promise.all([pruneGraph(chat.personId), rebuildMemories(to, again.reads)]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** An older read, loaded when picked from the history dropdown (the page only ships the latest in full). */
export async function loadRead(id: string): Promise<Analysis | null> {
  const user = await requireUser();
  const r = await db.analysis.findFirst({ where: { id, ...alive, person: { userId: user.id, ...alive } }, select: { result: true } });
  return (r?.result ?? null) as Analysis | null;
}

/* ---------- Timeline facts ---------- */

const factSchema = z.object({
  text: z.string().trim().min(1, "Write something").max(1000),
  kind: z.enum(["FACT", "EVENT", "DATE", "PREFERENCE"]),
  happenedAt: z.string().optional().transform((s) => (s ? new Date(s) : null)).refine((d) => !d || !Number.isNaN(d.getTime()), "Invalid date"),
  // Comma-separated tags ("sister, wedding"): what connects this memory to others.
  entities: z.string().max(300).optional().transform((s) => toEntities((s ?? "").split(","))),
  // How they felt about it, and how good or bad it was for them (-2..2): the emotion graph.
  feeling: z.string().max(60).optional().transform(toFeeling),
  valence: z.string().max(3).optional(),
}).transform((d) => ({ ...d, valence: toValence(d.valence, d.feeling) }));

export async function saveFact(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const personId = String(form.get("personId") ?? "");
  const person = await getPerson(user.id, personId);
  if (!person) return { error: "Not found" };
  const parsed = factSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const id = form.get("id")?.toString();
  if (id) {
    const res = await db.personFact.updateMany({ where: { id, personId, ...alive }, data: parsed.data });
    if (!res.count) return { error: "Not found" };
    // The graph follows the tags: edges to things no longer tagged go, new tags are linked.
    await retagMemory(person, id, parsed.data.entities);
  } else {
    // With the user's key, a new name that means something already known joins it (lib/graph/vectors.ts).
    await saveMemories(person, [parsed.data], { source: "USER" }, (await getActiveKey(user.id)) ?? undefined);
  }
  scheduleGraphJob(user.id, person);
  // The whole person section: the read's advice depends on the timeline too.
  revalidatePath(`/people/${personId}`, "layout");
  return { ok: true };
}

/** The chat line behind a graph edge, for the memory map: decrypted here, on demand, for the owner only. */
export async function edgeQuote(edgeId: string): Promise<{ text: string; date: string; by: string } | null> {
  const user = await requireUser();
  const e = await db.memoryEdge.findFirst({
    where: { id: edgeId, person: { userId: user.id, ...alive }, fact: { ...alive } },
    select: { quoteCipher: true, quoteTs: true, quoteSender: true, person: { select: { name: true } } },
  });
  if (!e?.quoteCipher) return null;
  return { text: decrypt(e.quoteCipher), date: e.quoteTs ? new Date(Number(e.quoteTs)).toISOString().slice(0, 10) : "", by: e.quoteSender === "me" ? "You" : e.person.name };
}

/* ---------- Coach threads ---------- */

/** What a coach reply was built from (the "why?" toggle). Owner-scoped through the thread's person. */
export async function loadTrace(messageId: string): Promise<Record<string, unknown> | null> {
  const user = await requireUser();
  const m = await db.coachMessage.findFirst({ where: { id: messageId, thread: { ...alive, person: { userId: user.id, ...alive } } }, select: { trace: true } });
  return (m?.trace ?? null) as Record<string, unknown> | null;
}

export async function renameThread(id: string, title: string): Promise<ActionState> {
  const user = await requireUser();
  const t = z.string().trim().min(1).max(80).safeParse(title);
  if (!t.success) return { error: "Title must be 1–80 characters" };
  const res = await db.coachThread.updateMany({ where: { id, person: { userId: user.id }, ...alive }, data: { title: t.data } });
  if (!res.count) return { error: "Not found" };
  revalidatePath("/people", "layout");
  return { ok: true };
}
