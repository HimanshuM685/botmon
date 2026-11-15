-- Retries counted apart (unreadable answers vs an overloaded model), and why a background read is waiting.
-- IF NOT EXISTS: a database that ran an edited copy of 20261120100000_read_retries already has them.
ALTER TABLE "ChatUpload" ADD COLUMN IF NOT EXISTS "readBadTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatUpload" ADD COLUMN IF NOT EXISTS "readWait" TEXT;
