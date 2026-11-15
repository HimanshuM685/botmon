import "server-only";
import { generateText, Output } from "ai";
import type { z } from "zod";
import { CHEAP_MODEL, type ProviderId } from "./models";
import { getModel } from "./provider";

/**
 * Background model calls (graph work, conversation summaries): always the user's own key, on the provider's
 * cheapest model, falling back to the model they chose when their key can't use that one.
 */
export type Key = { provider: ProviderId; model: string; apiKey: string };

async function withCheap<T>(key: Key, run: (model: string) => Promise<T>): Promise<T> {
  try {
    return await run(CHEAP_MODEL[key.provider]);
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (CHEAP_MODEL[key.provider] === key.model || !(status === 404 || status === 400 || /not found|does not exist|not available/i.test(String((e as Error)?.message)))) throw e;
    return run(key.model);
  }
}

export type Ask = <T>(schema: z.ZodType<T>, prompt: string) => Promise<T>;

/** A structured answer. */
export const cheapAsk = (key: Key): Ask => (schema, prompt) =>
  withCheap(key, async (model) => (await generateText({ model: getModel(key.provider, key.apiKey, model), output: Output.object({ schema }), prompt, temperature: 0, maxRetries: 1 })).output);

/** A plain-text answer. */
export const cheapText = (key: Key, prompt: string) =>
  withCheap(key, async (model) => (await generateText({ model: getModel(key.provider, key.apiKey, model), prompt, temperature: 0, maxRetries: 1 })).text);
