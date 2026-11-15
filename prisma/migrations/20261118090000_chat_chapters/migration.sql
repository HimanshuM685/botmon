-- Long chats are read chapter by chapter, once (lib/history.ts): what each period held is stored encrypted,
-- and memories learned from a chapter carry the chat they came from.
CREATE TABLE "ChatChapter" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "fromTs" TIMESTAMP(3) NOT NULL,
    "toTs" TIMESTAMP(3) NOT NULL,
    "msgCount" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChapter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatChapter_chatId_level_fromTs_idx" ON "ChatChapter"("chatId", "level", "fromTs");
ALTER TABLE "ChatChapter" ADD CONSTRAINT "ChatChapter_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ChatUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatUpload" ADD COLUMN "historyLockUntil" TIMESTAMP(3);

ALTER TABLE "PersonFact" ADD COLUMN "chatId" TEXT;
CREATE INDEX "PersonFact_chatId_idx" ON "PersonFact"("chatId");
