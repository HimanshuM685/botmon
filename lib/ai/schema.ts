import { z } from "zod";

const withEvidence = (label: string) =>
  z.object({ [label]: z.string(), evidence: z.string().describe("Short quote or paraphrase from the chat that shows it") });

/**
 * v2 read. Every field added after v1 is new; saved v1 reads only have the original fields,
 * so the UI treats everything as optional (DeepPartial).
 */
const signal = (anchors: string) =>
  z.object({
    level: z.number().describe(`0-4. ${anchors}`),
    evidence: z.string().describe("The observation(s) this rests on, or 'not enough signal'"),
  });

/** Rated by the model against fixed anchors; the 0-100 score is computed from these in code (lib/stats.ts computeScore). */
export const signalsSchema = z
  .object({
    reciprocity: signal("0 user carries everything; 2 roughly even but user leads; 4 they match or exceed the user's effort"),
    warmth: signal("0 cold or curt; 2 friendly but neutral; 4 openly affectionate, playful, glad to hear from the user"),
    selfDisclosure: signal("0 shares nothing personal; 2 surface updates (plans, whereabouts); 4 shares feelings, worries, private things"),
    curiosityAboutUser: signal("0 never asks about the user; 2 occasional polite questions; 4 actively asks follow-ups about the user's life"),
    futureTalk: signal("0 no plans or 'next time'; 2 vague or joking plans; 4 proposes or confirms concrete plans"),
    effort: signal("0 one-word or reaction-only replies; 2 short but engaged; 4 long, detailed, thoughtful replies"),
    consistency: signal("0 hot and cold, long unexplained gaps; 2 steady in bursts; 4 reliably present over time"),
  })
  .describe("Rate each strictly by its anchors and only from observations. With thin evidence stay at 1-2; do not reach 0 or 4 without clear, repeated evidence.");

export const analysisSchema = z.object({
  observations: z
    .array(
      z.object({
        when: z.string().describe("Timestamp from the chat, YYYY-MM-DD HH:MM"),
        quote: z.string().describe("Exact short quote or precise paraphrase"),
        signal: z.string().describe("What kind of signal: initiative, warmth, disclosure, curiosity, plans, effort, avoidance, mood, boundary, etc."),
        reading: z.string().describe("What it most plausibly shows about them, and how strongly"),
      }),
    )
    .describe("Write this FIRST. 6-15 of the most telling moments, spread across the whole chat. Everything after must be built on these."),
  signals: signalsSchema,
  mind: z
    .object({
      howTheySeeYou: withEvidence("view").describe("How they most likely see the user right now"),
      whatTheyWant: withEvidence("want").describe("What they seem to want from this connection: fun, friendship, attention, support, something more"),
      investment: z.string().describe("How much they put in compared with the user (initiation, effort, questions asked), using the computed stats"),
      emotionalPattern: z.string().describe("How they show interest, comfort, boredom or irritation in text, and what their silences tend to mean"),
      unknowns: z.array(z.string()).describe("What the chat cannot tell yet, each with what would reveal it"),
    })
    .describe("A model of their inner world. Every claim must trace to an observation; say 'not enough signal' instead of guessing. No clinical labels or diagnoses."),
  status: z.object({
    label: z.string().describe("2-5 word headline for where things stand, consistent with the signals, e.g. 'Warm but cooling', 'Clearly into you'"),
    trend: z.enum(["warming", "steady", "cooling"]).describe("Direction over the most recent weeks"),
    confidence: z.enum(["low", "medium", "high"]).describe("How sure you are, given how much chat there is"),
    explanation: z.string().describe("4-6 sentences explaining the current state, citing concrete patterns and moments"),
  }),
  personality: z.object({
    summary: z.string().describe("Who this person is, as seen in the chat: 3-5 sentences"),
    traits: z.array(withEvidence("trait")).describe("4-8 traits, each with evidence"),
  }),
  communicationStyle: z.string().describe("How they text: tone, length, humor, emoji, how they show care"),
  loveLanguages: z.array(withEvidence("language")).describe("How they give and want affection (words, time, gifts, acts, touch), strongest first"),
  emotional: z.object({
    currentMood: z.string().describe("Their emotional state lately"),
    triggers: z.array(z.string()).describe("What upsets, stresses or hurts them"),
    comforts: z.array(z.string()).describe("What makes them feel better or cared for"),
  }),
  interests: z.array(withEvidence("topic")).describe("Topics, hobbies, people and things they talk about with energy"),
  likes: z.array(z.string()).describe("2-5 things they clearly enjoy or light up about"),
  dislikes: z.array(z.string()).describe("2-5 things that annoy, bore or hurt them"),
  keyFacts: z
    .array(
      z.object({
        fact: z.string().describe("One concrete detail: names, places, family, work/study, health, plans, preferences, past events"),
        category: z.enum(["family", "friends", "work", "study", "health", "preference", "plan", "event", "other"]),
        when: z.string().describe("Date or period if known (YYYY-MM-DD preferred), else empty string"),
        about: z.array(z.string()).describe("1-4 short tags for who or what this is about, reused across facts so related ones connect: e.g. 'sister riya', 'job', 'mumbai trip', 'sushi'. Not the person themself."),
      }),
    )
    .describe("Every concrete detail worth remembering about them. Be exhaustive; this becomes long-term memory."),
  importantDates: z.array(z.object({ date: z.string().describe("YYYY-MM-DD or MM-DD"), what: z.string() })).describe("Birthdays, exams, trips, anniversaries, deadlines"),
  openThreads: z.array(z.string()).describe("Unresolved things: unanswered questions, promises made, plans not yet confirmed"),
  timeline: z.array(z.object({ period: z.string(), phase: z.string(), summary: z.string() })).describe("Phases of the relationship so far, oldest first"),
  conflicts: z
    .array(z.object({ when: z.string(), about: z.string(), resolved: z.boolean(), lesson: z.string() }))
    .describe("Arguments, tension or hurt feelings and what they teach. Empty if none."),
  yourSide: z.object({
    strengths: z.array(z.string()).describe("What the user does well in this chat"),
    blindSpots: z.array(z.string()).describe("What the user does that hurts the connection, said kindly"),
  }),
  greenFlags: z.array(z.string()).describe("0-5, each tied to an observation"),
  redFlags: z.array(z.string()).describe("0-5 concerning patterns on either side. Empty if none."),
  thingsToCareAbout: z.array(z.string()).describe("2-5 things the user should keep in mind or pay attention to"),
  nextMoves: z.array(
    z.object({
      action: z.string(),
      why: z.string(),
      when: z.string().describe("Timing, e.g. 'tonight', 'this weekend', 'after she replies'"),
    }),
  ).describe("Exactly 2: the best immediate move, then the follow-up after it"),
  messageSuggestions: z.array(z.string()).describe("Exactly 4 ready-to-send messages typed exactly the way the user types (see 'How the user types'): their casing, punctuation, spellings, emoji and length. A line break inside one means separate messages sent in a row."),
  conversationStarters: z.array(z.string()).describe("Topics or questions that would land well with them, based on their interests"),
  avoid: z.array(z.string()).describe("2-5 things the user should stop or avoid doing"),
});

const advice = analysisSchema.pick({ openThreads: true, thingsToCareAbout: true, nextMoves: true, messageSuggestions: true, conversationStarters: true, avoid: true }).shape;
/** Advice is rewritten on every model update; these judgement sections only when new information moves them. */
export const ADVICE_KEYS = ["whatChanged", ...Object.keys(advice)] as ("whatChanged" | keyof typeof advice)[];
export const PATCH_SECTIONS = ["status", "signals", "mind", "emotional"] as const;
const unchanged = "null when the new information does not change it (it is kept as is)";

/**
 * A model update: what the living read looks like after new notes, memories or time passing. No chat re-read.
 * Sections come before advice so the advice is written from the updated picture.
 */
export const modelPatchSchema = z.object({
  whatChanged: z.string().describe("1-2 sentences: which new information you used and which parts of the read it moved. Empty string if nothing beyond the chat."),
  status: analysisSchema.shape.status.nullable().describe(`Where things stand now, or ${unchanged}`),
  signals: signalsSchema.nullable().describe(`All seven signals re-rated with the new information as evidence, or ${unchanged}`),
  mind: analysisSchema.shape.mind.nullable().describe(`Their inner world now, or ${unchanged}`),
  emotional: analysisSchema.shape.emotional.nullable().describe(`Their mood, triggers and comforts now, or ${unchanged}`),
  ...advice,
});
export type ModelPatch = z.infer<typeof modelPatchSchema>;

type Generated = z.infer<typeof analysisSchema>;
/** `status.score` is computed in code after generation (older saved reads carry the model's own score there). */
export type Analysis = Omit<Generated, "status"> & {
  status: Generated["status"] & { score?: number };
  whatChanged?: string;
  /** How many of the user's own messages the suggestions' typing style was measured from (lib/voice.ts). */
  voiceFrom?: number;
};
