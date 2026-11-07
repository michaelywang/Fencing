import path from "node:path";
import fs from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Fresh, migrated database for every E2E run. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://fencing:fencing@localhost:5432/fencing_e2e";
  if (!/e2e|test/i.test(url)) throw new Error(`Refusing to reset a database whose URL does not contain "e2e" or "test": ${url}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
  fs.mkdirSync(path.resolve("tests/e2e/.artifacts"), { recursive: true });
}
