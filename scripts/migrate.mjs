// Applies SQL migrations from ./drizzle. Safe to run repeatedly.
// Used by `npm run db:migrate`, the Vercel build (`vercel-build`), and the Docker entrypoint.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local / .env for local runs (hosted platforms inject env vars directly).
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (fs.existsSync(p) && typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(p); } catch { /* ignore malformed local env files */ }
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  if (process.env.SKIP_MIGRATIONS_WITHOUT_DB === "1") {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations (SKIP_MIGRATIONS_WITHOUT_DB=1).");
    process.exit(0);
  }
  console.error("[migrate] DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(root, "drizzle") });
  console.log("[migrate] database is up to date.");
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
