export const PROVIDERS = {
  GEMINI: {
    label: "Google Gemini",
    models: ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"],
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "Free key from Google AI Studio",
  },
  OPENAI: {
    label: "OpenAI",
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.6-luna"],
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "Paid, billed to your OpenAI account",
  },
  GROK: {
    label: "xAI Grok",
    models: ["grok-latest", "grok-4.7", "grok-4.20-non-reasoning"],
    keyUrl: "https://console.x.ai",
    hint: "Paid, billed to your xAI account",
  },
  GROQ: {
    label: "Groq",
    models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct-0905"],
    keyUrl: "https://console.groq.com/keys",
    hint: "Free tier, very fast",
  },
  NIM: {
    label: "NVIDIA NIM",
    models: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "qwen/qwen3-235b-a22b"],
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    hint: "Free credits on build.nvidia.com",
  },
  OPENROUTER: {
    label: "OpenRouter",
    models: ["~deepseek/deepseek-flash-latest", "anthropic/claude-sonnet-5.5", "~anthropic/claude-haiku-latest"],
    keyUrl: "https://openrouter.ai/keys",
    hint: "400+ models, some free",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// Chat history budget in characters; Gemini has a ~1M token window, others are smaller.
export const CHAR_BUDGET: Record<ProviderId, number> = { GEMINI: 600_000, OPENAI: 200_000, GROK: 400_000, GROQ: 40_000, NIM: 60_000, OPENROUTER: 200_000 };
/** Chars per call for a key: its learned budget (getActiveKey, lib/data.ts) or the provider default. */
export const budgetFor = (key: { provider: ProviderId; budget?: number }) => key.budget ?? CHAR_BUDGET[key.provider];

/**
 * The cheapest capable model of each provider, for background graph work (lib/graph/job.ts): categories, typed
 * edges for old memories, evidence, summaries. A key that can't use it falls back to the user's own model.
 */
export const CHEAP_MODEL: Record<ProviderId, string> = {
  GEMINI: "gemini-flash-lite-latest",
  OPENAI: "gpt-5.6-luna",
  GROK: "grok-4.20-non-reasoning",
  GROQ: "llama-3.3-70b-versatile",
  NIM: "meta/llama-3.3-70b-instruct",
  OPENROUTER: "~deepseek/deepseek-flash-latest",
};

/**
 * Providers whose key can embed, and the model used (lib/graph/vectors.ts). The others (Grok, Groq, OpenRouter)
 * resolve names by spelling only; nothing else changes for them.
 */
export const EMBED_MODEL: Partial<Record<ProviderId, string>> = { GEMINI: "gemini-embedding-001", OPENAI: "text-embedding-3-small", NIM: "baai/bge-m3" };
export const embedModelFor = (provider: ProviderId) => EMBED_MODEL[provider] ?? null;

/** Which provider a pasted key belongs to, from its prefix. Undefined when it doesn't look like any of them. */
export function detectProvider(key: string): ProviderId | undefined {
  const k = key.trim();
  if (k.startsWith("AIza")) return "GEMINI";
  if (k.startsWith("xai-")) return "GROK";
  if (k.startsWith("gsk_")) return "GROQ";
  if (k.startsWith("nvapi-")) return "NIM";
  if (k.startsWith("sk-or-")) return "OPENROUTER";
  if (k.startsWith("sk-")) return "OPENAI";
  return undefined;
}

/** Where each provider lists the models a key can use. All but Gemini answer in the OpenAI shape ({ data: [{ id }] }). */
export const MODELS_URL: Record<ProviderId, string> = {
  GEMINI: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
  OPENAI: "https://api.openai.com/v1/models",
  GROK: "https://api.x.ai/v1/models",
  GROQ: "https://api.groq.com/openai/v1/models",
  NIM: "https://integrate.api.nvidia.com/v1/models",
  OPENROUTER: "https://openrouter.ai/api/v1/models",
};

/** Not text chat: these can't write a read or coach. */
const NOT_CHAT = /embed|rerank|whisper|tts|speech|audio|transcri|realtime|image|imagen|vision-preview|dall-e|sora|veo|video|moderation|guard|safety|aqa|search|computer-use|robotics|codex|instruct$|davinci|babbage|clip|ocr|parakeet|riva|nv-?dino|detect|segment|deplot|kosmos|-tts|learnlm|gemma-3n/i;
const MAX_LISTED = 1000;

/**
 * Chat models from a provider's model-list answer, the app's suggested ones first, then by name.
 * ponytail: non-chat models are dropped by name, since the lists don't say what a model is for (Gemini aside);
 * a new kind of non-chat model shows up in the dropdown until its name is added to NOT_CHAT.
 */
export function parseModelList(provider: ProviderId, json: unknown): string[] {
  const body = json as { models?: { name?: string; supportedGenerationMethods?: string[] }[]; data?: { id?: string; architecture?: { output_modalities?: string[] }; supported_parameters?: string[] }[] } | null;
  // OpenRouter says what each model outputs and takes, so no name guessing there; `:batch` ids are batch-only.
  // Reads need structured outputs and coaching needs tools, so models without both are left out.
  const ids =
    provider === "OPENROUTER"
      ? (body?.data ?? []).filter((m) => m.architecture?.output_modalities?.join() === "text" && !m.id?.endsWith(":batch") && ["structured_outputs", "tools"].every((p) => m.supported_parameters?.includes(p))).map((m) => m.id)
      : provider === "GEMINI"
      ? (body?.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name?.replace(/^models\//, ""))
      : (body?.data ?? []).map((m) => m.id);
  const chat = [...new Set(ids.filter((id): id is string => !!id && (provider === "OPENROUTER" || !NOT_CHAT.test(id))))];
  if (provider === "OPENAI") chat.splice(0, chat.length, ...chat.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id)));
  const suggested: readonly string[] = PROVIDERS[provider].models;
  const rank = (id: string) => (suggested.includes(id) ? suggested.indexOf(id) : suggested.length);
  return chat.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_LISTED);
}
