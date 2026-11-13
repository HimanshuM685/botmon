import "server-only";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { withTrashFilter } from "./soft-delete";

function create() {
  // Pooled Neon URL for app traffic. attachDatabasePool lets Vercel Fluid close idle clients before suspend.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  attachDatabasePool(pool);
  return withTrashFilter(new PrismaClient({ adapter: new PrismaPg(pool) }));
}

const g = globalThis as unknown as { prisma?: ReturnType<typeof create> };
export const db = g.prisma ?? create();
if (process.env.NODE_ENV !== "production") g.prisma = db;
