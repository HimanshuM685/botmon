-- Long chats are read in the background (lib/read/job.ts); keys learn how much one call may carry.
ALTER TABLE "ChatUpload" ADD COLUMN "readMode" TEXT;
ALTER TABLE "ChatUpload" ADD COLUMN "readNextAt" TIMESTAMP(3);
ALTER TABLE "ChatUpload" ADD COLUMN "readError" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "charBudget" INTEGER;
