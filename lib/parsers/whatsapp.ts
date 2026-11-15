import { type Msg, type ParsedChat, sendersOf } from "./types";

// Handles Android "31/12/23, 9:41 pm - Name: hi" and iOS "[31/12/23, 9:41:12 PM] Name: hi",
// with /, . or - date separators, 12h or 24h clocks, and multi-line messages.
// A header must end with "] " (iOS) or " - " (Android) so a continuation line that merely starts with a date
// ("12/5/24, 10:00 works for me") stays part of the previous message.
// Messages copied inside WhatsApp (select, Copy) have no year: "[14/11, 9:41 pm] Name: hi".
const HEADER =
  /^\[?(\d{1,4})[/.\-](\d{1,2})(?:[/.\-](\d{1,4}))?,?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?(?:\]\s*|\s+[-–]\s+)(.*)$/i;
const MEDIA = /^(<media omitted>|<attached: .*>|(image|video|audio|sticker|gif|document) omitted|.*\.(jpg|jpeg|png|webp|opus|mp4|pdf) \(file attached\))$/i;

const clean = (s: string) => s.replace(/[‎‏‪-‮]/g, "").replace(/[  ]/g, " ");

const DAY = 86_400_000;

export function parseWhatsApp(raw: string, now = Date.now()): ParsedChat {
  const lines = clean(raw).split(/\r?\n/);
  // A date without a year only counts in brackets, so "12/5, 10:00 - works for me" inside a message stays text.
  const heads = lines.map((l) => {
    const h = HEADER.exec(l);
    return h && (h[3] || l.startsWith("[")) ? h : null;
  });

  // Day/month order: a first field > 12 means DD/MM, a second field > 12 means MM/DD.
  let order: boolean | undefined;
  for (const h of heads) {
    if (!h || h[1].length === 4) continue;
    if (+h[1] > 12) { order = true; break; }
    if (+h[2] > 12) { order = false; break; }
  }

  const thisYear = new Date(now).getFullYear();
  const build = (dayFirst: boolean) => {
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
      if (c && a.length === 4) [y, mo, d] = [+a, +b, +c];
      else [d, mo, y] = dayFirst ? [+a, +b, +(c ?? thisYear)] : [+b, +a, +(c ?? thisYear)];
      if (y < 100) y += 2000;
      let hour = +hh;
      const pm = ampm?.toLowerCase().startsWith("p");
      if (ampm) hour = (hour % 12) + (pm ? 12 : 0);
      const at = (year: number) => new Date(year, mo - 1, d, hour, +mm, +(ss ?? 0)).getTime();
      let ts = at(y);
      // ponytail: no year in copied messages, so take the latest year that isn't in the future.
      // A copied block spanning 12+ months gets wrong years; exports carry the year.
      if (!c && ts > now + DAY) ts = at(y - 1);

      const colon = rest.indexOf(": ");
      if (colon <= 0 || Number.isNaN(ts)) { last = null; return; } // system line ("X joined", encryption notice)
      const sender = rest.slice(0, colon).trim();
      let text = rest.slice(colon + 2);
      if (MEDIA.test(text.trim())) text = "[media]";
      last = { sender, text, ts };
      messages.push(last);
    });
    return messages;
  };

  let messages: Msg[];
  if (order !== undefined) messages = build(order);
  else {
    // Every day is 12 or lower (short pastes): a chat runs forward in time, and one being added usually ends
    // within the last month. Take the order with fewer backward jumps, then the one that ends recently.
    // A tie stays DD/MM.
    const stale = (end = 0) => Number(end > now + DAY || end < now - 31 * DAY);
    const score = (m: Msg[]) => [m.filter((x, i) => i > 0 && x.ts < m[i - 1].ts).length, stale(m.at(-1)?.ts)];
    const [dm, md] = [build(true), build(false)];
    const [s1, s2] = [score(dm), score(md)];
    const k = s1.findIndex((v, i) => v !== s2[i]);
    messages = k >= 0 && s2[k] < s1[k] ? md : dm;
  }

  return { source: "WHATSAPP", messages, senders: sendersOf(messages) };
}
