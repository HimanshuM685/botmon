import { z } from "zod";

const withEvidence = (label: string) =>
  z.object({ [label]: z.string(), evidence: z.string().describe("Short quote or paraphrase from the chat that shows it") });

/**
 * v2 read. Every field added after v1 is new; saved v1 reads only have the original fields,
 * so the UI treats everything as optional (DeepPartial).
 */
export const analysisSchema = z.object({
  status: z.object({
    label: z.string().describe("2-5 word headline for where things stand, e.g. 'Warm but cooling', 'Clearly into you'"),
    score: z.number().min(0).max(100).describe("Interest (crush) or relationship health (partner) score, 0-100"),
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
  likes: z.array(z.string()).describe("Things they clearly enjoy or light up about"),
  dislikes: z.array(z.string()).describe("Things that annoy, bore or hurt them"),
  keyFacts: z
    .array(
      z.object({
        fact: z.string().describe("One concrete detail: names, places, family, work/study, health, plans, preferences, past events"),
        category: z.enum(["family", "friends", "work", "study", "health", "preference", "plan", "event", "other"]),
        when: z.string().describe("Date or period if known (YYYY-MM-DD preferred), else empty string"),
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
  greenFlags: z.array(z.string()),
  redFlags: z.array(z.string()).describe("Concerning patterns on either side. Empty if none."),
  thingsToCareAbout: z.array(z.string()).describe("What the user should keep in mind or pay attention to"),
  nextMoves: z.array(
    z.object({
      action: z.string(),
      why: z.string(),
      when: z.string().describe("Timing, e.g. 'tonight', 'this weekend', 'after she replies'"),
    }),
  ),
  messageSuggestions: z.array(z.string()).describe("3-5 ready-to-send messages written in the user's own texting style"),
  conversationStarters: z.array(z.string()).describe("Topics or questions that would land well with them, based on their interests"),
  avoid: z.array(z.string()).describe("Things the user should stop or avoid doing"),
});

export type Analysis = z.infer<typeof analysisSchema>;
