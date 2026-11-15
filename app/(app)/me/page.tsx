import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { alive } from "@/lib/trash";
import { selfVoice } from "@/lib/self/store";
import { visible } from "@/lib/self/traits";
import { SelfProfileView } from "@/components/self-profile";

export const metadata = { title: "You" };

export default async function MePage() {
  const user = await requireUser();
  const [profile, traits, voice, people] = await Promise.all([
    db.selfProfile.findUnique({ where: { userId: user.id }, select: { summary: true } }),
    db.selfTrait.findMany({
      where: { userId: user.id, ...alive },
      orderBy: [{ pinned: "desc" }, { confidence: "desc" }, { lastSeenAt: "desc" }],
      select: { id: true, kind: true, text: true, scope: true, relation: true, confidence: true, support: true, people: true, source: true, edited: true, pinned: true, noEvidence: true },
    }),
    selfVoice(user.id),
    db.person.count({ where: { userId: user.id, ...alive } }),
  ]);
  return (
    <SelfProfileView
      summary={profile?.summary ?? null}
      traits={traits.filter(visible)}
      people={people}
      // Habits only: the merged voice's sample messages stay on the server.
      voice={voice ? { count: voice.count, medianWords: voice.medianWords, lowerStart: voice.lowerStart, emojiShare: voice.emojiShare, topEmoji: voice.topEmoji, words: voice.words.slice(0, 12), burst: voice.burst, questionMark: voice.questionMark } : null}
    />
  );
}
