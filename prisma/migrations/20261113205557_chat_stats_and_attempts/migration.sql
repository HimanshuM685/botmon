/*
  Warnings:

  - Added the required column `stats` to the `ChatUpload` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Analysis" ALTER COLUMN "result" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChatUpload" ADD COLUMN     "stats" JSONB NOT NULL,
ADD COLUMN     "tzOffset" INTEGER NOT NULL DEFAULT 0;
