-- The chat a new upload (or a chat moved here, or restored from the trash) pushed to the trash,
-- so removing it can bring exactly that one back.
ALTER TABLE "ChatUpload" ADD COLUMN "replacedId" TEXT;
