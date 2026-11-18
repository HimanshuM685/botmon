-- Which background read a step belongs to: a step still running from a stopped read can't touch the next one.
ALTER TABLE "ChatUpload" ADD COLUMN "readJob" TEXT;
-- Reads already going when this ships get an id, or their next step would find no job and stop.
UPDATE "ChatUpload" SET "readJob" = md5(random()::text || id) WHERE "readMode" IS NOT NULL;
