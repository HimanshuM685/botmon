-- A debrief is a coach thread that points at the rehearsal it discusses.
-- The link lives on the thread, so later turns do not re-read the first message's JSON.
ALTER TABLE "CoachThread" ADD COLUMN "debriefOfId" TEXT;

ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_debriefOfId_fkey"
  FOREIGN KEY ("debriefOfId") REFERENCES "CoachThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
