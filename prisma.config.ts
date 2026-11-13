import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations need a direct (unpooled) connection on Neon.
  datasource: { url: process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"] },
});
