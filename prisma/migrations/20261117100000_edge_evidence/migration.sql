-- Evidence on edges: when it was said, how (tone, polarity), and the exact chat line, encrypted like the chat it
-- came from. `minedAt`: the chat was already searched for this edge. `supersededById`: a newer edge on the same
-- pair says the opposite.
ALTER TABLE "MemoryEdge" ADD COLUMN "at" TIMESTAMP(3),
  ADD COLUMN "tone" TEXT,
  ADD COLUMN "polarity" INTEGER,
  ADD COLUMN "quoteCipher" TEXT,
  ADD COLUMN "quoteTs" BIGINT,
  ADD COLUMN "quoteSender" TEXT,
  ADD COLUMN "supersededById" TEXT,
  ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "minedAt" TIMESTAMP(3);
