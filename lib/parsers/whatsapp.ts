import { type Msg, type ParsedChat, sendersOf } from "./types";

// Handles Android "31/12/23, 9:41 pm - Name: hi" and iOS "[31/12/23, 9:41:12 PM] Name: hi",
// with /, . or - date separators, 12h or 24h clocks, and multi-line messages.
// A header must end with "] " (iOS) or " - " (Android) so a continuation line that merely starts with a date
// ("12/5/24, 10:00 works for me") stays part of the previous message.
const HEADER =
  /^\[?(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?(?:\]\s*|\s+[-–]\s+)(.*)$/i;
const MEDIA = /^(<media omitted>|<attached: .*>|(image|video|audio|sticker|gif|document) omitted|.*\.(jpg|jpeg|png|webp|opus|mp4|pdf) \(file attached\))$/i;

const clean = (s: string) => s.replace(/[‎‏‪-‮]/g, "").replace(/[  ]/g, " ");

export function parseWhatsApp(raw: string): ParsedChat {
  const lines = clean(raw).split(/\r?\n/);
  const heads = lines.map((l) => HEADER.exec(l));

  // Decide day/month order: a first field > 12 means DD/MM, a second field > 12 means MM/DD. Default DD/MM.
  let dayFirst = true;
  for (const h of heads) {
    if (!h || h[1].length === 4) continue;
    if (+h[1] > 12) { dayFirst = true; break; }
    if (+h[2] > 12) { dayFirst = false; break; }
  }

  const messages: Msg[] = [];
  let last: Msg | null = null;
  lines.forEach((line, i) => {
    const h = heads[i];
    if (!h) {
      if (last && line.trim()) last.text += "\n" + line;
      return;
    }
    const [, a, b, c, hh, mm, ss, ampm, rest] = h;
    let y: number, mo: number, d: number;
    if (a.length === 4) [y, mo, d] = [+a, +b, +c];
    else [d, mo, y] = dayFirst ? [+a, +b, +c] : [+b, +a, +c];
    if (y < 100) y += 2000;
    let hour = +hh;
    const pm = ampm?.toLowerCase().startsWith("p");
    if (ampm) hour = (hour % 12) + (pm ? 12 : 0);
    const ts = new Date(y, mo - 1, d, hour, +mm, +(ss ?? 0)).getTime();

    const colon = rest.indexOf(": ");
    if (colon <= 0 || Number.isNaN(ts)) { last = null; return; } // system line ("X joined", encryption notice)
    const sender = rest.slice(0, colon).trim();
    let text = rest.slice(colon + 2);
    if (MEDIA.test(text.trim())) text = "[media]";
    last = { sender, text, ts };
    messages.push(last);
  });

  return { source: "WHATSAPP", messages, senders: sendersOf(messages) };
}
