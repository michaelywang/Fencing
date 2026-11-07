import "server-only";
import type { DbOrTx } from "@/server/db";
import { auditLog } from "@/server/db/schema";

/** Records security-relevant administrative actions (never includes secrets). */
export async function audit(db: DbOrTx, userId: string | null, action: string, details: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ userId, action, details });
}
