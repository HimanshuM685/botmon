/** Result of asking the server to bring a person's read up to date (see app/api/people/[id]/model). */
export type ModelSync = { status: "current" | "updated" | "created" | "failed"; whatChanged?: string; error?: string };

/**
 * Call after anything that changes what is known about a person (coach memory, timeline edit).
 * Cheap when nothing changed: the server answers 204 without calling the model.
 */
export async function syncModel(personId: string): Promise<ModelSync> {
  try {
    const res = await fetch(`/api/people/${personId}/model`, { method: "POST" });
    if (res.status === 204) return { status: "current" };
    if (!res.ok) return { status: "failed", error: (await res.json().catch(() => null))?.error };
    const created = res.headers.get("x-model-mode") === "create";
    const body = await res.text(); // the server saves once the stream is fully read
    let whatChanged: string | undefined;
    try {
      whatChanged = (JSON.parse(body) as { whatChanged?: string }).whatChanged || undefined;
    } catch {
      return { status: "failed", error: "The model returned an incomplete answer" };
    }
    return { status: created ? "created" : "updated", whatChanged };
  } catch {
    return { status: "failed" };
  }
}
