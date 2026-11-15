-- Embeddings of node labels (never chat lines), so "dahi" finds "curd". Graphs are small per person: exact
-- cosine filtered by person and model, no ANN index, no fixed dimension (each provider has its own).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "MemoryNode" ADD COLUMN "embedding" vector, ADD COLUMN "embedModel" TEXT;
