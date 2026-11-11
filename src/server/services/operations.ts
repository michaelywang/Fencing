import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db";
import { operations } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { isUuid } from "./ids";

/**
 * Idempotent bulk operations. The browser generates one operation id per user
 * action and reuses it for retries (lost responses, double clicks). The id is
 * recorded in the SAME transaction as the work, so a replay returns the stored
 * result instead of acting twice. Concurrent duplicates block on the primary
 * key until the first commits, then replay.
 */
export async function runOperation<T>(
  operationId: string | null | undefined,
  kind: string,
  actor: SessionUser | null,
  seasonId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T & { replayed?: boolean }> {
  if (operationId !== undefined && operationId !== null && !isUuid(operationId)) throw badRequest("Invalid operation id.");
  return getDb().transaction(async (tx) => {
    if (operationId) {
      const inserted = await tx
        .insert(operations)
        .values({ id: operationId, kind, userId: actor?.id ?? null, seasonId })
        .onConflictDoNothing()
        .returning({ id: operations.id });
      if (inserted.length === 0) {
        const [prev] = await tx.select().from(operations).where(eq(operations.id, operationId)).limit(1);
        if (!prev || prev.kind !== kind) throw new AppError(409, "operation_reused", "This operation id was already used for a different action.");
        return { ...((prev.result ?? {}) as T), replayed: true };
      }
    }
    const result = await fn(tx);
    if (operationId) {
      await tx.update(operations).set({ result: sql`${JSON.stringify(result ?? {})}::jsonb` }).where(eq(operations.id, operationId));
    }
    return result as T & { replayed?: boolean };
  });
}
