-- What the user is like, learned only from their own lines (lib/self/ingest.ts), and the lines behind each trait.
CREATE TYPE "SelfKind" AS ENUM ('INTEREST', 'HOBBY', 'VALUE', 'HABIT', 'TEXTING', 'AFFECTION', 'STRENGTH', 'BLIND_SPOT', 'PATTERN', 'FACT');
CREATE TYPE "SelfScope" AS ENUM ('GLOBAL', 'RELATION');
CREATE TYPE "SelfSource" AS ENUM ('ANALYSIS', 'CHAPTER', 'COACH', 'GRAPH', 'USER');

CREATE TABLE "SelfTrait" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SelfKind" NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scope" "SelfScope" NOT NULL DEFAULT 'RELATION',
    "relation" "Relation",
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "support" INTEGER NOT NULL DEFAULT 0,
    "people" INTEGER NOT NULL DEFAULT 0,
    "source" "SelfSource" NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "noEvidence" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SelfTrait_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SelfTrait_userId_kind_key_key" ON "SelfTrait"("userId", "kind", "key");
CREATE INDEX "SelfTrait_userId_deletedAt_idx" ON "SelfTrait"("userId", "deletedAt");
ALTER TABLE "SelfTrait" ADD CONSTRAINT "SelfTrait_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SelfEvidence" (
    "id" TEXT NOT NULL,
    "traitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "chatId" TEXT,
    "chapterId" TEXT,
    "analysisId" TEXT,
    "quoteCipher" TEXT,
    "quoteTs" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SelfEvidence_traitId_personId_quoteTs_key" ON "SelfEvidence"("traitId", "personId", "quoteTs");
CREATE INDEX "SelfEvidence_personId_idx" ON "SelfEvidence"("personId");
CREATE INDEX "SelfEvidence_chatId_idx" ON "SelfEvidence"("chatId");
CREATE INDEX "SelfEvidence_analysisId_idx" ON "SelfEvidence"("analysisId");
ALTER TABLE "SelfEvidence" ADD CONSTRAINT "SelfEvidence_traitId_fkey" FOREIGN KEY ("traitId") REFERENCES "SelfTrait"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfEvidence" ADD CONSTRAINT "SelfEvidence_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfEvidence" ADD CONSTRAINT "SelfEvidence_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ChatUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelfEvidence" ADD CONSTRAINT "SelfEvidence_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "ChatChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
