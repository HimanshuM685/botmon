-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "chatId" TEXT,
ADD COLUMN "throughAt" TIMESTAMP(3),
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'full';
