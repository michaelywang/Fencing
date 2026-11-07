import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";
import { tooManyRequests } from "@/server/errors";

/**
 * Fixed-window rate limiting stored in Postgres, so it works across
 * serverless instances without extra infrastructure.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
  const result = await getDb().execute<{ count: number; window_start: string }>(sql`
    INSERT INTO rate_limits (key, count, window_start) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count, window_start
  `);
  const row = result.rows[0];
  const count = Number(row.count);
  const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
  return { allowed: count <= limit, count, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)) };
}

/** Throws a 429 AppError when any of the keys is over its limit. */
export async function enforceRateLimits(checks: Array<{ key: string; limit: number; windowSeconds: number }>): Promise<void> {
  for (const c of checks) {
    const r = await hitRateLimit(c.key, c.limit, c.windowSeconds);
    if (!r.allowed) throw tooManyRequests(r.retryAfterSeconds);
  }
}

/** Housekeeping: drop rate-limit windows older than a day. */
export async function purgeOldRateLimits(): Promise<void> {
  await getDb().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}

export async function resetRateLimit(key: string): Promise<void> {
  await getDb().delete(rateLimits).where(eq(rateLimits.key, key));
}
