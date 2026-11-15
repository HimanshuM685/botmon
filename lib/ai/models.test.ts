import { expect, it } from "vitest";
import { detectProvider, parseModelList } from "./models";

it("detects the provider from a pasted key", () => {
  expect(detectProvider(" AIzaSyABC ")).toBe("GEMINI");
  expect(detectProvider("sk-proj-abc")).toBe("OPENAI");
  expect(detectProvider("xai-abc")).toBe("GROK");
  expect(detectProvider("gsk_abc")).toBe("GROQ");
  expect(detectProvider("nvapi-abc")).toBe("NIM");
  expect(detectProvider("sk-or-v1-abc")).toBe("OPENROUTER");
  expect(detectProvider("hello")).toBeUndefined();
});

it("lists chat models only, suggested ones first", () => {
  const gemini = parseModelList("GEMINI", { models: [
    { name: "models/gemini-zeta", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-pro-latest", supportedGenerationMethods: ["generateContent"] },
    { name: "models/imagen-4", supportedGenerationMethods: ["generateContent"] },
  ] });
  expect(gemini).toEqual(["gemini-pro-latest", "gemini-zeta"]);
  const openai = parseModelList("OPENAI", { data: [{ id: "whisper-1" }, { id: "gpt-5.5" }, { id: "text-embedding-3-large" }, { id: "gpt-5.6" }, { id: "gpt-audio" }, { id: "o4-mini" }, { id: "gpt-5.5" }] });
  expect(openai).toEqual(["gpt-5.6", "gpt-5.5", "o4-mini"]);
  expect(parseModelList("GROQ", { data: [{ id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }, { id: "meta-llama/llama-guard-4-12b" }] })).toEqual(["llama-3.3-70b-versatile"]);
  expect(parseModelList("NIM", null)).toEqual([]);
  const text = { output_modalities: ["text"] };
  expect(parseModelList("OPENROUTER", { data: [
    { id: "mistralai/mistral-7b-instruct", architecture: text },
    { id: "google/gemini-image", architecture: { output_modalities: ["image", "text"] } },
    { id: "anthropic/claude-sonnet-5.5:batch", architecture: text },
    { id: "anthropic/claude-sonnet-5.5", architecture: text },
  ] })).toEqual(["anthropic/claude-sonnet-5.5", "mistralai/mistral-7b-instruct"]);
});
