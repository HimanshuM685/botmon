-- The user's own profile, shared by every person (lib/self/*).
-- Voices hold real sample messages, so they are stored encrypted like the chat they come from.
ALTER TABLE "ChatUpload" ADD COLUMN "voiceCipher" TEXT;
ALTER TABLE "User" ADD COLUMN "selfNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "SelfProfile" (
    "userId" TEXT NOT NULL,
    "voiceCipher" TEXT,
    "summary" TEXT,
    "contextHash" TEXT,
    "lockUntil" TIMESTAMP(3),
    "runs" INTEGER NOT NULL DEFAULT 0,
    "runsSince" TIMESTAMP(3),
    "throughAt" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfProfile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "SelfProfile" ADD CONSTRAINT "SelfProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
