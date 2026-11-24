// Needle test for total recall (lib/memory): a synthetic chat of NEEDLE_MSGS messages (default 5 lakh) with 50 details
// each said once, run through the real sittings / detail / embedding steps on a real database, then 100 questions
// (50 naming the thing, 50 only describing it) asked through recallMemory, the coach's remember_detail.
//
//   NEEDLE_DB=<host of DATABASE_URL> [EVAL_PROVIDER=GEMINI EVAL_API_KEY=...] npm run needle
//
// NEVER point it at production: it refuses unless NEEDLE_DB names the database host, so it can't run by accident.
// Without a key it runs the sittings and word search only. With one, the detail pass reads the sittings around each
// detail (NEEDLE_DETAILS=all reads every sitting: ~1,800 calls at 5 lakh) and every sitting is embedded
// (NEEDLE_EMBED=none skips that). The test user is deleted at the end unless NEEDLE_KEEP=1.
import "dotenv/config";
import { gzipSync } from "node:zlib";
import { generateText, tool } from "ai";
import { db } from "@/lib/db";
import { getModel } from "@/lib/ai/provider";
import { REMEMBER_DETAIL } from "@/lib/ai/coach";
import { encrypt } from "@/lib/crypto";
import { embedModelFor, PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/ai/models";
import { rateLimit } from "@/lib/ai/limits";
import { embedEpisodes, memoryWork, readDetails, syncEpisodes } from "@/lib/memory/episodes";
import { recallMemory } from "@/lib/memory/recall";
import type { Msg } from "@/lib/parsers/types";

const host = new URL(process.env.DATABASE_URL ?? "postgres://none").hostname;
if (!process.env.NEEDLE_DB || !host.includes(process.env.NEEDLE_DB)) {
  console.error(`needle: refusing to run. Set NEEDLE_DB to the database host (${host}) to confirm it is a test database.`);
  process.exit(1);
}
const provider = process.env.EVAL_PROVIDER?.toUpperCase() as ProviderId | undefined;
const apiKey = process.env.EVAL_API_KEY;
if (provider && !PROVIDER_IDS.includes(provider)) throw new Error(`EVAL_PROVIDER must be one of ${PROVIDER_IDS.join(", ")}`);
const key = provider && apiKey ? { provider, apiKey, model: process.env.EVAL_MODEL || PROVIDERS[provider].models[0] } : null;
const TOTAL = Number(process.env.NEEDLE_MSGS) || 500_000;

// [what she says once, a question naming it, a question only describing it, what the answer must contain]
const NEEDLES: [string, string, string, string][] = [
  ["mujhe Japanese wonton bahut pasand hai yaar", "does she like wontons", "what food does she love", "wonton"],
  ["I'm allergic to kiwi, my throat starts itching", "kiwi allergy", "is she allergic to anything", "kiwi"],
  ["my cat's name is Mochi btw", "Mochi", "does she have a pet", "mochi"],
  ["mera blood group O negative hai", "blood group", "what is her blood type", "negative"],
  ["I always wanted to learn the cello", "cello", "which instrument does she want to learn", "cello"],
  ["meri nani Shimla mein rehti hai", "Shimla", "where does her grandmother live", "shimla"],
  ["favourite colour? teal, always teal", "teal", "what's her favourite colour", "teal"],
  ["I'm scared of escalators honestly", "escalators", "what is she afraid of", "escalators"],
  ["my first concert was Coldplay in 2017", "Coldplay", "which band did she first see live", "coldplay"],
  ["I hate coriander, it tastes like soap", "coriander", "which herb does she hate", "coriander"],
  ["mera dream hai Iceland jaana northern lights dekhne", "Iceland", "where does she dream of travelling", "iceland"],
  ["my brother Kabir is doing his MBA in Pune", "Kabir", "what does her brother study", "kabir"],
  ["I wear size 6 shoes, always hard to find", "shoe size", "what size footwear does she wear", "size 6"],
  ["I was born in Jalandhar", "Jalandhar", "which city is she originally from", "jalandhar"],
  ["my favourite book is The Little Prince", "Little Prince", "what book does she love", "little prince"],
  ["chai mein adrak nahi, sirf elaichi", "elaichi", "how does she take her tea", "elaichi"],
  ["I collect old postage stamps", "stamps", "what does she collect", "stamps"],
  ["my ex was a drummer named Arjun", "drummer", "what did her ex do", "drummer"],
  ["I can't swim, never learnt as a kid", "swim", "is she comfortable in water", "swim"],
  ["my best friend Tanvi is moving to Berlin in March", "Tanvi", "where is her best friend moving", "berlin"],
  ["I'm lactose intolerant so no milkshakes for me", "lactose", "can she have dairy", "lactose"],
  ["I sleep with a night lamp on, darkness scares me", "night lamp", "is she afraid of the dark", "night lamp"],
  ["my favourite movie is Spirited Away", "Spirited Away", "which animated film does she like most", "spirited away"],
  ["I did karate till green belt", "karate", "did she do any martial arts", "karate"],
  ["papa ka birthday 14 August ko hai", "papa birthday", "when is her father's birthday", "14 august"],
  ["I'm left handed fyi", "left handed", "which hand does she write with", "left handed"],
  ["rajma chawal is my ultimate comfort food", "rajma", "what is her comfort food", "rajma"],
  ["I want to name my daughter Ira someday", "daughter name", "what baby names does she like", "ira"],
  ["my phone wallpaper is a sunflower field", "wallpaper", "what's on her phone screen", "sunflower"],
  ["I failed my driving test twice", "driving test", "did she struggle to get a licence", "driving test"],
  ["I'm a huge Arsenal fan", "Arsenal", "which football club does she support", "arsenal"],
  ["I hate the smell of petrol", "petrol", "which smell does she dislike", "petrol"],
  ["mera favourite perfume Jo Malone Wood Sage hai", "perfume", "what fragrance does she wear", "wood sage"],
  ["I had my tonsils removed when I was 9", "tonsils", "has she had any surgery", "tonsils"],
  ["I really want a golden retriever named Bruno", "Bruno", "what dog does she want", "bruno"],
  ["monsoon is my favourite season, I love the rain", "monsoon", "what weather does she like", "monsoon"],
  ["I used to stammer as a kid", "stammer", "did she have a speech problem growing up", "stammer"],
  ["I'm learning Korean on Duolingo", "Korean", "what language is she learning", "korean"],
  ["my mom is a chemistry teacher", "chemistry", "what does her mother do for work", "chemistry"],
  ["pineapple on pizza is a crime", "pineapple", "which pizza topping does she hate", "pineapple"],
  ["I get migraines when I skip lunch", "migraines", "does she get headaches", "migraine"],
  ["my favourite flower is lily of the valley", "lily", "which flowers does she like", "lily"],
  ["I sang alto in the school choir", "choir", "did she sing growing up", "choir"],
  ["I want to open a bakery in Goa someday", "bakery", "what is her business dream", "bakery"],
  ["mera lucky number 27 hai", "lucky number", "which number does she think brings luck", "27"],
  ["I broke my wrist skating in class 8", "wrist", "has she ever broken a bone", "wrist"],
  ["I don't eat mushrooms, the texture is weird", "mushrooms", "which vegetable does she refuse to eat", "mushroom"],
  ["my favourite singer is Arijit Singh", "Arijit", "which musician does she love", "arijit"],
  ["I'm saving up for a Vespa", "Vespa", "what is she saving money for", "vespa"],
  ["humari pehli date Hauz Khas mein thi", "Hauz Khas", "where was our first date", "hauz khas"],
];

// Filler: everyday chat with near misses (other foods, places, people, music), so search has to be specific.
const FILLER = (
  "good morning|gm|kya kar rahi ho|kuch nahi bas lying down|office ja rahi hu|traffic bahut hai aaj|lunch kiya?|haan maggi bana li|" +
  "aaj biryani khayi canteen mein|momos khane chalein?|pizza order kar rahe hai|mummy bula rahi hai brb|ok|hmm|haha|lol|sach mein?|" +
  "kal mall chalein?|movie dekhne chalein weekend pe|which one|koi bhi rom com|bahut thak gayi aaj|meeting lambi chali|boss ne daanta|" +
  "chill kar|good night|gn sweet dreams|so ja ab|tu bhi|miss you|call karu?|abhi nahi baad mein|ok fine|gussa ho?|nahi yaar|" +
  "riya ki shaadi hai next month|kya pehnu samajh nahi aa raha|blue wala acha lagega|thanks|song bhej raha hu sun|nice hai|" +
  "barish ho rahi hai yahan|delhi mein bahut garmi hai|AC chala ke so ja|exam kab hai|next week|padhai kar le phir|" +
  "netflix pe kya dekh rahi ho|ek series hai thriller|spoiler mat dena|gym gayi aaj?|nahi aalas aa raha tha|kal pakka|" +
  "dog bahut bhauk raha hai bahar|papa ki tabiyat theek hai?|haan ab better hai|chai pi li?|coffee pi rahi hu|" +
  "weekend plans?|ghar pe hi|bored ho rahi hu|game khele?|ludo?|haan chal|tu haar gaya haha|rematch|kal baat karte hai"
).split("|");

/** Small seeded random, so the same run plants the same details in the same places. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makeChat(): { msgs: Msg[]; at: number[] } {
  const r = rng(42), msgs: Msg[] = [];
  let ts = Date.UTC(2024, 0, 1, 4);
  for (let i = 0; i < TOTAL; i++) {
    // Chatty sittings of minutes, then a break of hours.
    ts += r() < 0.03 ? 3_600_000 * (1 + r() * 10) : 20_000 + r() * 150_000;
    msgs.push({ sender: r() < 0.5 ? "Anushna" : "Me", text: FILLER[Math.floor(r() * FILLER.length)], ts: Math.round(ts) });
  }
  // One detail every TOTAL/50 messages, at a random point of its slot, said by her.
  const slot = Math.floor(TOTAL / NEEDLES.length);
  const at = NEEDLES.map((n, i) => i * slot + Math.floor(r() * slot));
  at.forEach((p, i) => (msgs[p] = { ...msgs[p], sender: "Anushna", text: NEEDLES[i][0] }));
  const filler = FILLER.join(" ").toLowerCase();
  for (const n of NEEDLES) if (new RegExp(`\\b${n[3]}\\b`).test(filler)) throw new Error(`filler says "${n[3]}"`);
  return { msgs, at };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

/** Run a step until it says it is done, waiting out rate limits and overloads like the job does. */
async function until(what: string, step: () => Promise<boolean>) {
  let tries = 0;
  for (;;) {
    try {
      if (await step()) return;
      tries = 0;
    } catch (e) {
      if (++tries > 30) throw e;
      const wait = Math.min(rateLimit(e)?.waitMs ?? 20_000 * tries, 300_000);
      console.log(`  ${what}: ${String((e as Error)?.message ?? e).slice(0, 120)}; waiting ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

const { msgs, at } = makeChat();
const id = crypto.randomUUID();
const user = await db.user.create({ data: { id, email: `needle-${id}@test.invalid` } });
const person = await db.person.create({ data: { userId: user.id, name: "Anushna", relation: "CRUSH", gender: "FEMALE" } });
const chat = await db.chatUpload.create({
  data: {
    personId: person.id, source: "PASTE", cipher: encrypt(gzipSync(JSON.stringify({ messages: msgs }))), msgCount: msgs.length,
    firstAt: new Date(msgs[0].ts), lastAt: new Date(msgs.at(-1)!.ts), myName: "Me", theirName: "Anushna", tzOffset: 0,
  },
});
console.log(`needle: ${msgs.length.toLocaleString("en-IN")} messages, ${NEEDLES.length} details, db ${host}, key ${key ? `${key.provider} (${key.model})` : "none"}`);

try {
  let t = Date.now();
  let steps = 0;
  await until("sittings", async () => (steps++, syncEpisodes(chat, msgs)));
  const work = await memoryWork(chat.id, key ?? { provider: "GROQ" });
  console.log(`sittings: ${work.total} in ${steps} steps, ${secs(t)}`);

  if (key) {
    if (process.env.NEEDLE_DETAILS !== "all") {
      // Only the sittings around each detail are read (two either side: about one detail call of real context).
      const eps = await db.chatEpisode.findMany({ where: { chatId: chat.id }, orderBy: { fromTs: "asc" }, select: { id: true, fromTs: true, toTs: true } });
      const keep = new Set<string>();
      for (const p of at) {
        const i = eps.findIndex((e) => e.fromTs.getTime() <= msgs[p].ts && msgs[p].ts <= e.toTs.getTime());
        eps.slice(Math.max(0, i - 2), i + 3).forEach((e) => keep.add(e.id));
      }
      await db.chatEpisode.updateMany({ where: { chatId: chat.id, id: { notIn: [...keep] } }, data: { detailsAt: new Date() } });
    }
    t = Date.now();
    const who = { id: person.id, name: person.name, relation: person.relation, gender: person.gender };
    await until("details", async () => {
      // Some calls can fail while others save: those sittings stay unread and this loop asks for them again.
      const r = await readDetails(who, chat, key, { signal: AbortSignal.timeout(200_000), stillHere: async () => true });
      const left = (await memoryWork(chat.id, key)).detailsLeft;
      console.log(`  details: ${r.saved} sittings read, ${left} left${r.failure ? ` (some calls failed: ${(r.failure as Error)?.message?.slice(0, 120)}; retrying them)` : ""}`);
      if (r.failure && left) await sleep(Math.min(rateLimit(r.failure)?.waitMs ?? 20_000, 300_000));
      return left === 0;
    });
    const facts = await db.personFact.count({ where: { personId: person.id } });
    console.log(`details: ${facts} memories saved, ${secs(t)}`);

    if (embedModelFor(key.provider) && process.env.NEEDLE_EMBED !== "none") {
      t = Date.now();
      await until("embed", async () => {
        await embedEpisodes(chat.id, key);
        const left = (await memoryWork(chat.id, key)).embedLeft;
        console.log(`  embed: ${left} sittings left`);
        return left === 0;
      });
      console.log(`embed: done, ${secs(t)}`);
    }
  }

  // Ask as the coach does: its model fills remember_detail's query and words (NEEDLE_EXPAND=none: the question alone).
  const wordsFor = async (q: string) => {
    if (!key || process.env.NEEDLE_EXPAND === "none") return [];
    let words: string[] = [];
    await until("words", async () => {
      const { toolCalls } = await generateText({
        model: getModel(key.provider, key.apiKey, key.model),
        system: "You coach the user about Anushna, the person they chat with. Look the user's question up in your memory.",
        prompt: q,
        tools: { remember_detail: tool(REMEMBER_DETAIL) },
        toolChoice: { type: "tool", toolName: "remember_detail" },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(60_000),
      });
      words = (toolCalls[0]?.input as { words?: string[] })?.words ?? [];
      return true;
    });
    return words;
  };

  // Ask. A hit names the thing and shows the day it was said.
  const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const score = { named: 0, described: 0, namedDated: 0, describedDated: 0 };
  const misses: string[] = [];
  const times: number[] = [];
  for (const [i, [, named, described, marker]] of NEEDLES.entries()) {
    const want = new RegExp(`\\b${marker}`, "i");
    for (const [kind, q] of [["named", named], ["described", described]] as const) {
      const words = await wordsFor(q);
      const t0 = Date.now();
      let out = "";
      await until("recall", async () => ((out = await recallMemory(person.id, q, key, 0, words)), true));
      times.push(Date.now() - t0);
      const hit = want.test(out), dated = hit && out.includes(day(msgs[at[i]].ts));
      if (hit) score[kind]++;
      if (dated) score[`${kind}Dated`]++;
      if (!hit) misses.push(`${kind}: "${q}" [${words.join(", ")}] (wants ${marker})`);
    }
  }
  const facts = key ? await db.personFact.findMany({ where: { personId: person.id }, select: { text: true } }) : [];
  const extracted = NEEDLES.filter((n) => facts.some((f) => new RegExp(`\\b${n[3]}`, "i").test(f.text))).length;
  times.sort((a, b) => a - b);
  console.log(`\nrecall, naming the thing:      ${score.named}/50 (${score.namedDated} with the right day)`);
  console.log(`recall, only describing it:   ${score.described}/50 (${score.describedDated} with the right day)`);
  if (key) console.log(`details saved as memories:    ${extracted}/50`);
  console.log(`recall time: median ${times[times.length >> 1]}ms, slowest ${times.at(-1)}ms`);
  if (misses.length) console.log(`misses:\n  ${misses.join("\n  ")}`);
} finally {
  if (process.env.NEEDLE_KEEP !== "1") await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
