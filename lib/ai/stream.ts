import "server-only";
import type { TextStreamPart, ToolSet } from "ai";
import { providerError } from "./provider";

/**
 * Turn a streamText result into a plain-text streaming Response for useObject.
 * Waits for the first token so auth/quota errors become a proper JSON error instead of an empty stream,
 * and runs `onDone` (the save) before closing so the client's refresh sees the result.
 */
export async function streamResponse(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
  opts: { label: string; onDone: () => Promise<void>; headers?: Record<string, string> },
) {
  const parts = stream[Symbol.asyncIterator]();
  const next = async (): Promise<{ text: string } | { error: unknown } | null> => {
    for (;;) {
      const n = await parts.next();
      if (n.done) return null;
      if (n.value.type === "text-delta") return { text: n.value.text };
      if (n.value.type === "error") return { error: n.value.error };
    }
  };
  const first = await next();
  if (!first || "error" in first) {
    const err = first?.error ?? new Error("The model returned nothing");
    console.error(`${opts.label} failed`, (err as Error)?.message);
    return Response.json({ error: providerError(err) }, { status: 502 });
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(enc.encode(first.text)),
    async pull(c) {
      const n = await next();
      if (!n) {
        // Invalid/partial JSON throws inside onDone and is simply not saved.
        await opts.onDone().catch((e) => console.error(`${opts.label} not saved`, (e as Error)?.message));
        return c.close();
      }
      if ("error" in n) return c.error(n.error);
      c.enqueue(enc.encode(n.text));
    },
    cancel: () => void parts.return?.(),
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...opts.headers } });
}

/** Stable 31-bit sampling seed from an id, so the same input gives the same answer where providers support seeds. */
export function seedFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h & 0x7fffffff;
}
