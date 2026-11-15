-- The memory graph proper: nodes (people, places, things) and typed directed edges between them.
CREATE TABLE "MemoryNode" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'thing',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryEdge" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "rel" TEXT NOT NULL,
    "label" TEXT,
    "factId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemoryNode_personId_key_key" ON "MemoryNode"("personId", "key");
CREATE INDEX "MemoryEdge_personId_idx" ON "MemoryEdge"("personId");
CREATE INDEX "MemoryEdge_fromId_idx" ON "MemoryEdge"("fromId");
CREATE INDEX "MemoryEdge_toId_idx" ON "MemoryEdge"("toId");
CREATE INDEX "MemoryEdge_factId_idx" ON "MemoryEdge"("factId");

ALTER TABLE "MemoryNode" ADD CONSTRAINT "MemoryNode_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "MemoryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "MemoryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryEdge" ADD CONSTRAINT "MemoryEdge_factId_fkey" FOREIGN KEY ("factId") REFERENCES "PersonFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the tags memories already carry: one node per tag, and "them MENTIONS tag" for each tagged memory.
INSERT INTO "MemoryNode" ("id", "personId", "key", "label", "kind")
SELECT gen_random_uuid()::text, p."id", 'them', 'them', 'them' FROM "Person" p
WHERE EXISTS (SELECT 1 FROM "PersonFact" f WHERE f."personId" = p."id" AND cardinality(f."entities") > 0);

INSERT INTO "MemoryNode" ("id", "personId", "key", "label", "kind")
SELECT gen_random_uuid()::text, t."personId", t."tag", t."tag", 'thing'
FROM (SELECT DISTINCT f."personId", unnest(f."entities") AS "tag" FROM "PersonFact" f) t
WHERE t."tag" NOT IN ('them', 'me')
ON CONFLICT ("personId", "key") DO NOTHING;

INSERT INTO "MemoryEdge" ("id", "personId", "fromId", "toId", "rel", "factId")
SELECT gen_random_uuid()::text, f."personId", them."id", n."id", 'MENTIONS', f."id"
FROM "PersonFact" f
CROSS JOIN LATERAL unnest(f."entities") AS e("tag")
JOIN "MemoryNode" n ON n."personId" = f."personId" AND n."key" = e."tag"
JOIN "MemoryNode" them ON them."personId" = f."personId" AND them."key" = 'them';
