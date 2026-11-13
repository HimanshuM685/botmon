"use server";

import { generateText } from "ai";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { MAX_PEOPLE, getPerson } from "@/lib/data";
import { PROVIDER_IDS, type ProviderId } from "@/lib/ai/models";
import { getModel, providerError } from "@/lib/ai/provider";
import { RELATIONS } from "@/lib/ai/prompt";

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function signOutAction() {
  await auth.signOut();
  redirect("/");
}

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
  if ((await db.person.count({ where: { userId: user.id } })) >= MAX_PEOPLE)
    return { error: `You can track up to ${MAX_PEOPLE} people.` };
  const person = await db.person.create({ data: { ...parsed.data, userId: user.id } });
  redirect(`/people/${person.id}`);
}

export async function deletePerson(id: string) {
  const user = await requireUser();
  await db.person.deleteMany({ where: { id, userId: user.id } });
  redirect("/dashboard");
}

const keySchema = z.object({
  provider: z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]),
  apiKey: z.string().trim().min(10, "That key looks too short").max(500),
  model: z.string().trim().min(1).max(120),
});

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

export async function deleteKey(provider: ProviderId) {
  const user = await requireUser();
  await db.apiKey.deleteMany({ where: { userId: user.id, provider } });
  revalidatePath("/settings");
}

export async function setDefaultProvider(provider: ProviderId) {
  const user = await requireUser();
  if (!(await db.apiKey.findFirst({ where: { userId: user.id, provider } }))) return;
  await db.user.update({ where: { id: user.id }, data: { defaultProvider: provider } });
  revalidatePath("/settings");
}

export async function deleteAccount() {
  const user = await requireUser();
  await db.user.delete({ where: { id: user.id } }); // cascades to keys, people, chats, analyses
  const { error } = await auth.deleteUser({});
  if (error) console.error("neon auth deleteUser failed", error.message);
  await auth.signOut();
  redirect("/");
}
