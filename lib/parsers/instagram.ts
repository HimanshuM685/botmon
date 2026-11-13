import { type Msg, type ParsedChat, sendersOf } from "./types";

type IgFile = {
  messages?: { sender_name?: string; timestamp_ms?: number; content?: string; photos?: unknown; videos?: unknown; audio_files?: unknown; share?: unknown }[];
};

// Meta exports UTF-8 bytes escaped as latin1 code points ("Ã°Â\u009f..." for emoji). Re-decode them.
export function fixMojibake(s: string): string {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

export function parseInstagram(jsonFiles: string[]): ParsedChat {
  const messages: Msg[] = [];
  for (const raw of jsonFiles) {
    const file = JSON.parse(raw) as IgFile;
    if (!Array.isArray(file.messages)) throw new Error("Not an Instagram message_*.json file");
    for (const m of file.messages) {
      if (!m.sender_name || !m.timestamp_ms) continue;
      const text = m.content
        ? fixMojibake(m.content)
        : m.photos || m.videos || m.audio_files || m.share
          ? "[media]"
          : "";
      if (!text) continue;
      messages.push({ sender: fixMojibake(m.sender_name), text, ts: m.timestamp_ms });
    }
  }
  messages.sort((a, b) => a.ts - b.ts);
  return { source: "INSTAGRAM", messages, senders: sendersOf(messages) };
}
