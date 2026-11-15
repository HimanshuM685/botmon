-- Background reads retry overloaded models and unreadable answers with waits, and keep their progress for the page.
ALTER TABLE "ChatUpload" ADD COLUMN "readTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatUpload" ADD COLUMN "readBadTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatUpload" ADD COLUMN "readWait" TEXT;
ALTER TABLE "ChatUpload" ADD COLUMN "readParts" INTEGER;
ALTER TABLE "ChatUpload" ADD COLUMN "readPartsDone" INTEGER;
