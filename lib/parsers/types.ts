export type Msg = { sender: string; text: string; ts: number };
export type ParsedChat = { source: "WHATSAPP" | "INSTAGRAM" | "PASTE"; messages: Msg[]; senders: string[] };

export function sendersOf(messages: Msg[]): string[] {
  const count = new Map<string, number>();
  for (const m of messages) count.set(m.sender, (count.get(m.sender) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
