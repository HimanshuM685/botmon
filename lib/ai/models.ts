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
} as const;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// Chat history budget in characters; Gemini has a ~1M token window, others are smaller.
export const CHAR_BUDGET: Record<ProviderId, number> = { GEMINI: 600_000, OPENAI: 200_000, GROK: 400_000, GROQ: 40_000, NIM: 60_000 };
