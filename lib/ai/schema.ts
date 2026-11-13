import { z } from "zod";

export const analysisSchema = z.object({
  status: z.object({
    label: z.string().describe("2-5 word headline for where things stand, e.g. 'Warm but cooling', 'Clearly into you'"),
    score: z.number().min(0).max(100).describe("Interest (crush) or relationship health (partner) score, 0-100"),
    explanation: z.string().describe("3-5 sentences explaining the current state, citing concrete patterns from the chat"),
  }),
  communicationStyle: z.string().describe("How they text: tone, length, humor, emoji, how they show care"),
  likes: z.array(z.string()).describe("Things they clearly enjoy or light up about"),
  dislikes: z.array(z.string()).describe("Things that annoy, bore or hurt them"),
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
  avoid: z.array(z.string()).describe("Things the user should stop or avoid doing"),
});

export type Analysis = z.infer<typeof analysisSchema>;
