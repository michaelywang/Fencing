import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

declare global {
  var __glfDb: { pool: Pool; db: Database; url: string } | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure your database.");
  }
  return url;
}

/**
 * Lazily created, process-wide connection pool (survives dev hot reloads).
 * Small pool: serverless instances each hold a few connections; use the
 * provider's pooled connection string (Neon "-pooler" host) in production.
 */
export function getDb(): Database {
  const url = connectionString();
  if (!globalThis.__glfDb || globalThis.__glfDb.url !== url) {
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on("error", (err) => console.error("[db] idle client error", err.message));
    globalThis.__glfDb = { pool, db: drizzle(pool, { schema }), url };
  }
  return globalThis.__glfDb.db;
}

export async function closeDb(): Promise<void> {
  const current = globalThis.__glfDb;
  globalThis.__glfDb = undefined;
  if (current) await current.pool.end();
}

export { schema };
