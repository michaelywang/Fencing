import "server-only";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { generateToken, sha256Hex } from "./crypto";

/**
 * Server-side sessions (OWASP Session Management pattern):
 *  - 256-bit random token in an HttpOnly, Secure (in production), SameSite=Lax cookie
 *  - only SHA-256(token) is stored, so a database leak does not leak live sessions
 *  - 30-day lifetime, extended on activity; revoked on password change/disable
 */
export const SESSION_DAYS = 30;
const RENEW_WHEN_DAYS_LEFT = 15;
const DAY_MS = 86_400_000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "coach";
}

export interface ValidSession {
  sessionId: string;
  expiresAt: Date;
  renewed: boolean;
  user: SessionUser;
}

export async function createSession(userId: string, userAgent = ""): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await getDb()
    .insert(sessions)
    .values({ id: sha256Hex(token), userId, expiresAt: expiresAt.toISOString(), userAgent: userAgent.slice(0, 300) });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined | null): Promise<ValidSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = getDb();
  const id = sha256Hex(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expiresAt);
  if (row.disabledAt || expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let renewed = false;
  let newExpiry = expiresAt;
  if (expiresAt.getTime() - Date.now() < RENEW_WHEN_DAYS_LEFT * DAY_MS) {
    newExpiry = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    renewed = true;
    await db
      .update(sessions)
      .set({ expiresAt: newExpiry.toISOString(), lastSeenAt: sql`now()` })
      .where(eq(sessions.id, id));
  }
  return {
    sessionId: id,
    expiresAt: newExpiry,
    renewed,
    user: { id: row.userId, email: row.email, name: row.name, role: row.role },
  };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateSessionByToken(token: string): Promise<void> {
  await invalidateSession(sha256Hex(token));
}

export async function invalidateUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const db = getDb();
  if (exceptSessionId) {
    await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)));
  } else {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }
}

export async function countActiveSessions(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)));
  return rows[0]?.n ?? 0;
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}
