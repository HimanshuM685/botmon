-- Scores the user chose to work on from the read ("Improve this"), and when a later read showed it improved.
CREATE TABLE "ScoreGoal" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toLevel" INTEGER,
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScoreGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScoreGoal_personId_deletedAt_idx" ON "ScoreGoal"("personId", "deletedAt");
ALTER TABLE "ScoreGoal" ADD CONSTRAINT "ScoreGoal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A coach thread opened from "Improve this" points at the goal it works on, like a debrief points at its rehearsal.
ALTER TABLE "CoachThread" ADD COLUMN "goalId" TEXT;
ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "ScoreGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
