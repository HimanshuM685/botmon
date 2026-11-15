-- "Coach me": a coach thread about the user themself, owned by the user, with no person.
ALTER TABLE "CoachThread" ALTER COLUMN "personId" DROP NOT NULL;
ALTER TABLE "CoachThread" ADD COLUMN "userId" TEXT;
CREATE INDEX "CoachThread_userId_deletedAt_updatedAt_idx" ON "CoachThread"("userId", "deletedAt", "updatedAt");
ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Exactly one owner: a person, or (for self threads) the user.
ALTER TABLE "CoachThread" ADD CONSTRAINT "CoachThread_owner_check" CHECK (("personId" IS NULL) <> ("userId" IS NULL));
