import "server-only";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import type { ProviderId } from "./models";

export function getModel(provider: ProviderId, apiKey: string, model: string) {
  switch (provider) {
    case "GEMINI":
      return createGoogle({ apiKey })(model);
    case "OPENAI":
      return createOpenAI({ apiKey })(model);
    case "GROK":
      return createXai({ apiKey })(model);
    case "GROQ":
      return createGroq({ apiKey })(model);
    case "NIM":
      return createOpenAI({ apiKey, baseURL: "https://integrate.api.nvidia.com/v1" }).chat(model);
  }
}

export function providerError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  const status = (e as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403 || /api key|unauthori[sz]ed|permission|invalid.*key/i.test(msg))
    return "Your AI key was rejected. Update it in Settings.";
  if (status === 429 || /quota|rate limit|resource.?exhausted/i.test(msg))
    return "Your AI provider's quota or rate limit is used up. Wait a bit or switch provider in Settings.";
  if (/context|too long|maximum.*tokens|token limit|tokens per minute|request too large/i.test(msg))
    return "This chat is too long for the selected model. Pick a bigger-context model (Gemini) in Settings.";
  if (status === 404 || /model.*not found|does not exist/i.test(msg))
    return "That model isn't available for your key. Choose another model in Settings.";
  return `AI provider error: ${msg.slice(0, 160)}`;
}
