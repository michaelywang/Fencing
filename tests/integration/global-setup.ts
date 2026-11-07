import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Recreates the test database schema from the committed migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://fencing:fencing@localhost:5432/fencing_test";
  if (!/test/i.test(url)) throw new Error(`Refusing to reset a database whose URL does not contain "test": ${url}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}
