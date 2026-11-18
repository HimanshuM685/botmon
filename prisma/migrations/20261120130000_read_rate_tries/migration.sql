-- Rate limits counted apart from an overloaded model: long waits for a daily cap must not use up those tries.
ALTER TABLE "ChatUpload" ADD COLUMN "readRateTries" INTEGER NOT NULL DEFAULT 0;
