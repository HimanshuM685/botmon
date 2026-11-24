import { beforeEach, expect, it, vi } from "vitest";

/**
 * The detail pass's contract with the job (lib/read/job.ts memoryStep): calls that worked are saved even when others
 * failed, and come back with the failure; nothing saved throws. The cheap model falls back to the user's own.
 */

const h = vi.hoisted(() => ({
  rows: [] as { id: string; chars: number; cipher: string }[],
  marked: [] as string[],
  saved: [] as string[],
  calls: [] as string[],
  answer: (() => Promise.resolve({ output: { details: [] } })) as (model: string, prompt: string) => Promise<unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("../crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));
vi.mock("../ai/stream", () => ({ seedFor: () => 1 }));
vi.mock("../ai/provider", () => ({ getModel: (_p: string, _k: string, name: string) => name }));
vi.mock("../graph/vectors", () => ({ embed: vi.fn() }));
vi.mock("../graph-store", () => ({
  loadGraph: async () => ({ known: () => [] }),
  saveMemories: async (_p: unknown, rows: { text: string }[]) => {
    h.saved.push(...rows.map((r) => r.text));
    return { ids: rows.map((_, i) => `f${h.saved.length + i}`) };
  },
}));
vi.mock("ai", () => ({
  Output: { object: (o: unknown) => o },
  generateText: (o: { model: string; prompt: string }) => {
    h.calls.push(o.model);
    return h.answer(o.model, o.prompt);
  },
}));
vi.mock("../db", () => ({
  db: {
    chatEpisode: {
      findMany: async () => h.rows,
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => void h.marked.push(...where.id.in),
    },
    personFact: { findMany: async () => [] },
    $transaction: async () => [],
  },
}));

const { readDetails } = await import("./episodes");

const person = { id: "p1", name: "Riya", relation: "CRUSH", gender: "FEMALE" };
const chat = { id: "c1", myName: "Me", theirName: "Riya", tzOffset: 0 };
// A small budget: each sitting is its own call (half the budget, 500 chars, fits one 400-char sitting).
const key = { provider: "GEMINI" as const, apiKey: "k", model: "gemini-pro-latest", budget: 1_000 };
const opts = { stillHere: async () => true };
const sitting = (id: string, text: string) => ({ id, chars: 400, cipher: JSON.stringify([{ sender: "Riya", text, ts: Date.UTC(2026, 10, 1) }]) });
const detail = (fact: string) => ({ output: { details: [{ fact, category: "preference", when: "", about: [], feeling: "", valence: 0, triples: [], line: 1 }] } });
const busy = () => Promise.reject(Object.assign(new Error("This model is currently experiencing high demand"), { statusCode: 503 }));

beforeEach(() => {
  h.rows = [sitting("e1", "i love biryani"), sitting("e2", "FAIL here"), sitting("e3", "cheesecake is my fav")];
  h.marked = [];
  h.saved = [];
  h.calls = [];
});

it("saves the calls that worked and returns the failure with them; the failed sitting stays unread", async () => {
  h.answer = (_m, prompt) => (prompt.includes("FAIL") ? busy() : Promise.resolve(detail(prompt.includes("biryani") ? "Loves biryani" : "Favourite is cheesecake")));
  const out = await readDetails(person, chat, key, opts);
  expect(out.saved).toBe(2);
  expect((out.failure as Error).message).toMatch(/high demand/);
  expect(h.marked.sort()).toEqual(["e1", "e3"]);
  expect(h.saved.sort()).toEqual(["Favourite is cheesecake", "Loves biryani"]);
});

it("throws when nothing was saved, so the job waits and spends a try", async () => {
  h.answer = () => busy();
  await expect(readDetails(person, chat, key, opts)).rejects.toThrow(/high demand/);
  expect(h.marked).toEqual([]);
});

it("falls back from the cheap model to the user's own model", async () => {
  h.rows = [sitting("e1", "i love biryani")];
  h.answer = (model) => (model === "gemini-flash-lite-latest" ? busy() : Promise.resolve(detail("Loves biryani")));
  const out = await readDetails(person, chat, key, opts);
  expect(h.calls).toEqual(["gemini-flash-lite-latest", "gemini-pro-latest"]);
  expect(out).toEqual({ saved: 1, failure: undefined });
});

it("doesn't fall back when the step itself ran out of time", async () => {
  h.rows = [sitting("e1", "i love biryani")];
  h.answer = () => busy();
  const signal = AbortSignal.abort();
  await expect(readDetails(person, chat, key, { ...opts, signal })).rejects.toThrow();
  expect(h.calls).toEqual(["gemini-flash-lite-latest"]);
});

it("saves nothing when the chat left mid-step", async () => {
  h.answer = () => Promise.resolve(detail("Loves biryani"));
  expect(await readDetails(person, chat, key, { stillHere: async () => false })).toEqual({ saved: 0 });
  expect(h.marked).toEqual([]);
});

it("has nothing to do when every sitting is read", async () => {
  h.rows = [];
  expect(await readDetails(person, chat, key, opts)).toEqual({ saved: 0 });
  expect(h.calls).toEqual([]);
});
