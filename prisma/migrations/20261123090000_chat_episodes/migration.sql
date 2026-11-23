-- Total recall (lib/memory): every chat split into sittings, each searchable by keyed word hashes and by meaning,
-- and the detail pass's memories traced back to the sitting they were said in.
CREATE TABLE "ChatEpisode" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "fromTs" TIMESTAMP(3) NOT NULL,
    "toTs" TIMESTAMP(3) NOT NULL,
    "msgCount" INTEGER NOT NULL,
    "chars" INTEGER NOT NULL,
    "cipher" TEXT NOT NULL,
    "terms" INTEGER[],
    "embedding" vector,
    "embedModel" TEXT,
    "detailsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatEpisode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatEpisode_chatId_fromTs_idx" ON "ChatEpisode"("chatId", "fromTs");
-- Keyword lookup: which sittings contain all (or any) of the asked words' hashes.
CREATE INDEX "ChatEpisode_terms_idx" ON "ChatEpisode" USING GIN ("terms");
ALTER TABLE "ChatEpisode" ADD CONSTRAINT "ChatEpisode_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ChatUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonFact" ADD COLUMN "episodeId" TEXT;
ALTER TABLE "PersonFact" ADD COLUMN "saidAt" TIMESTAMP(3);
ALTER TABLE "PersonFact" ADD COLUMN "mentions" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PersonFact" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
