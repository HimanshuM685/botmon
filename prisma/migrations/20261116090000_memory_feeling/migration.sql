-- Emotion graph: how the person felt about a memory, and how good or bad it was for them (-2..2).
ALTER TABLE "PersonFact" ADD COLUMN "feeling" TEXT, ADD COLUMN "valence" INTEGER;
