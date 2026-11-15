-- Background graph work (lib/graph/job.ts): one run per person at a time with an hourly cap, like the model lock,
-- and how far it has got. `categorizedAt`: this node was already asked what it belongs under.
ALTER TABLE "Person" ADD COLUMN "graphLockUntil" TIMESTAMP(3),
  ADD COLUMN "graphRuns" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "graphRunsSince" TIMESTAMP(3),
  ADD COLUMN "graphThroughAt" TIMESTAMP(3),
  ADD COLUMN "graphFactsAt" TIMESTAMP(3);
ALTER TABLE "MemoryNode" ADD COLUMN "categorizedAt" TIMESTAMP(3);
