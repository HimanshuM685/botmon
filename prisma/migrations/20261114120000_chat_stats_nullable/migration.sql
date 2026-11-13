-- Already-migrated databases got stats as NOT NULL; make it nullable to match the schema (no-op elsewhere).
ALTER TABLE "ChatUpload" ALTER COLUMN "stats" DROP NOT NULL;
