-- Coach threads: a mode ("coach" or "rehearsal"), a running summary of the older part of a long conversation,
-- and a trace of what each reply was built from.
ALTER TABLE "CoachThread" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'coach',
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "summaryThroughId" TEXT;
ALTER TABLE "CoachMessage" ADD COLUMN "trace" JSONB;
