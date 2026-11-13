import type { PrismaClient } from "@/generated/prisma/client";

/** Models with a 30-day trash (deletedAt). */
export const SOFT_DELETE_MODELS = new Set(["User", "Person", "ChatUpload", "Analysis", "CoachThread", "PersonFact"]);
const READS = new Set(["findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/**
 * Reads on trashable models hide deleted rows unless the query mentions `deletedAt` itself.
 * Opt out explicitly: `deletedAt: undefined` (everything) or `deletedAt: { not: null }` (trash only).
 * findUnique, writes and nested relation reads are untouched (nested ones keep their explicit `alive` filters).
 */
export function addTrashFilter(model: string | undefined, operation: string, args: { where?: Record<string, unknown> }) {
  if (!model || !SOFT_DELETE_MODELS.has(model) || !READS.has(operation)) return args;
  if (args.where && "deletedAt" in args.where) return args;
  return { ...args, where: { ...args.where, deletedAt: null } };
}

export function withTrashFilter(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(addTrashFilter(model, operation, args as { where?: Record<string, unknown> }) as typeof args);
        },
      },
    },
  });
}
