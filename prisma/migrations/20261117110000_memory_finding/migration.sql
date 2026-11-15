-- Findings from the shape of the graph, stored so the coach can refer back to them and the read notices new ones.
CREATE TABLE "MemoryFinding" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "edgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "MemoryFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemoryFinding_personId_key_key" ON "MemoryFinding"("personId", "key");
ALTER TABLE "MemoryFinding" ADD CONSTRAINT "MemoryFinding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
