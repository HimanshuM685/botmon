-- Advice layer: which context (notes + timeline) the advice was written for, and when.
ALTER TABLE "Analysis" ADD COLUMN "contextHash" TEXT,
ADD COLUMN "adviceAt" TIMESTAMP(3);
