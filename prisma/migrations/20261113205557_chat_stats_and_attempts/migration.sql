-- stats is nullable: existing rows are encrypted, so they are backfilled lazily in app code (getChatStats).
-- AlterTable
ALTER TABLE "Analysis" ALTER COLUMN "result" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChatUpload" ADD COLUMN     "stats" JSONB,
ADD COLUMN     "tzOffset" INTEGER NOT NULL DEFAULT 0;
