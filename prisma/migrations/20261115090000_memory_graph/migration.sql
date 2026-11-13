-- Memory graph: entity tags on memories (shared tag = connected) and direct links between memories.
ALTER TABLE "PersonFact" ADD COLUMN "entities" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "MemoryLink" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "MemoryLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemoryLink_toId_idx" ON "MemoryLink"("toId");
CREATE UNIQUE INDEX "MemoryLink_fromId_toId_kind_key" ON "MemoryLink"("fromId", "toId", "kind");

ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "PersonFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "PersonFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
