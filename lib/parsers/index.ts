import { unzipSync, strFromU8 } from "fflate";
import { parseWhatsApp } from "./whatsapp";
import { parseInstagram } from "./instagram";
import type { ParsedChat } from "./types";

export type { Msg, ParsedChat } from "./types";
export { parseWhatsApp, parseInstagram };

const IG_FILE = /(^|\/)message_\d+\.json$/i;

/** Browser-side: turn uploaded files (WhatsApp .txt/.zip, Instagram .json(s) or zip) into messages. */
export async function parseFiles(files: File[]): Promise<ParsedChat> {
  const texts: { name: string; text: string }[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), {
        filter: (e) => !e.name.startsWith("__MACOSX") && (IG_FILE.test(e.name) || /\.txt$/i.test(e.name)),
      });
      for (const [name, data] of Object.entries(entries)) texts.push({ name, text: strFromU8(data) });
    } else {
      texts.push({ name: f.name, text: await f.text() });
    }
  }

  const json = texts.filter((t) => t.name.toLowerCase().endsWith(".json"));
  if (json.length) {
    const folders = new Set(json.map((t) => t.name.split("/").slice(0, -1).join("/")));
    if (folders.size > 1) throw new Error("This zip holds several conversations. Upload the message_*.json files from one chat folder.");
    return parseInstagram(json.map((t) => t.text));
  }
  const txt = texts.find((t) => t.name.toLowerCase().endsWith(".txt"));
  if (!txt) throw new Error("No chat found. Upload a WhatsApp .txt/.zip export or Instagram message_1.json.");
  return parseWhatsApp(txt.text);
}
