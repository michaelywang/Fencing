import "server-only";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { authTokens, users } from "@/server/db/schema";
import { generateToken, getDummyHash, hashPassword, needsRehash, safeEqual, sha256Hex, verifyPassword } from "@/server/auth/crypto";
import { createSession, invalidateUserSessions, purgeExpiredSessions, type SessionUser } from "@/server/auth/sessions";
import { enforceRateLimits, purgeOldRateLimits, resetRateLimit } from "@/server/auth/rate-limit";
import { AppError, badRequest, forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/audit";
import { emailEnabled, sendEmail } from "@/server/email";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/schemas";

const HOUR = 3_600_000;
const INVITE_TTL = 7 * 24 * HOUR;
const ADMIN_RESET_TTL = 72 * HOUR;
const SELF_RESET_TTL = 1 * HOUR;

export interface RequestMeta {
  ip: string;
  userAgent: string;
  appUrl: string;
}

export type Role = "admin" | "coach";

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid input");
  return r.data;
}

const genericLoginError = () => new AppError(401, "invalid_credentials", "Email or password is incorrect.");

// ---------------------------------------------------------------------------
// Bootstrap (first administrator)
// ---------------------------------------------------------------------------
export async function setupStatus(): Promise<{ needsSetup: boolean; tokenConfigured: boolean }> {
  const rows = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  const configured = (process.env.SETUP_TOKEN ?? "").length >= 16;
  return { needsSetup: (rows[0]?.n ?? 0) === 0, tokenConfigured: configured };
}

/**
 * Creates the first administrator. Requires the SETUP_TOKEN secret from the
 * hosting environment and only works while there are no accounts at all, so
 * there is no default password and no public sign-up that grants editing.
 */
export async function bootstrapAdmin(
  input: { setupToken: string; name: string; email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  await enforceRateLimits([{ key: `setup:ip:${meta.ip}`, limit: 10, windowSeconds: 3600 }]);
  const expected = process.env.SETUP_TOKEN ?? "";
  if (expected.length < 16) {
    throw new AppError(503, "setup_disabled", "Setup is disabled: SETUP_TOKEN is not configured on the server (min. 16 characters).");
  }
  if (!safeEqual(input.setupToken.trim(), expected)) throw forbidden("The setup token is incorrect.");
  const email = parse(emailSchema, input.email);
  const name = parse(nameSchema, input.name);
  const password = parse(passwordSchema, input.password);
  const passwordHash = await hashPassword(password);

  const db = getDb();
  const user = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('glf:setup'))`);
    const existing = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((existing[0]?.n ?? 0) > 0) throw new AppError(409, "setup_complete", "Setup is already complete. Sign in instead.");
    const [created] = await tx
      .insert(users)
      .values({ email, name, role: "admin", passwordHash, passwordChangedAt: sql`now()` })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    await audit(tx, created.id, "setup.admin_created", { email });
    return created;
  });
  const session = await createSession(user.id, meta.userAgent);
  return { user, ...session };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function login(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof input.password === "string" ? input.password.slice(0, 200) : "";
  await enforceRateLimits([
    { key: `login:ip:${meta.ip}`, limit: 50, windowSeconds: 900 },
    { key: `login:email:${email}`, limit: 10, windowSeconds: 900 },
  ]);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    await verifyPassword(password, await getDummyHash()); // equalize timing
    throw genericLoginError();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || user.disabledAt) throw genericLoginError();
  await resetRateLimit(`login:email:${email}`);
  const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: sql`now()` as unknown as string };
  if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(password);
  await db.update(users).set(updates).where(eq(users.id, user.id));
  // Occasional housekeeping instead of a scheduled job: expired sessions and stale rate-limit windows.
  if (Math.random() < 0.1) await Promise.all([purgeExpiredSessions(), purgeOldRateLimits()]).catch(() => {});
  const session = await createSession(user.id, meta.userAgent);
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, ...session };
}

// ---------------------------------------------------------------------------
// Coaches (admin)
// ---------------------------------------------------------------------------
export async function listUsers() {
  return getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .orderBy(asc(users.name));
}

export async function listPendingInvites() {
  return getDb()
    .select({
      id: authTokens.id,
      email: authTokens.email,
      role: authTokens.role,
      name: authTokens.name,
      createdAt: authTokens.createdAt,
      expiresAt: authTokens.expiresAt,
    })
    .from(authTokens)
    .where(and(eq(authTokens.kind, "invite"), isNull(authTokens.usedAt), isNull(authTokens.revokedAt), gt(authTokens.expiresAt, sql`now()`)))
    .orderBy(desc(authTokens.createdAt));
}

function requireAdmin(actor: SessionUser) {
  if (actor.role !== "admin") throw forbidden("Only administrators can manage coaches.");
}

export async function createInvite(
  actor: SessionUser,
  input: { email: string; role: Role; name?: string },
  appUrl: string,
): Promise<{ url: string; expiresAt: string; emailed: boolean; email: string }> {
  requireAdmin(actor);
  const email = parse(emailSchema, input.email);
  const role: Role = input.role === "admin" ? "admin" : "coach";
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new AppError(409, "exists", "A coach account with this email already exists.");
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL).toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(authTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(authTokens.kind, "invite"), eq(authTokens.email, email), isNull(authTokens.usedAt), isNull(authTokens.revokedAt)));
    await tx.insert(authTokens).values({ kind: "invite", tokenHash: sha256Hex(token), email, role, name, createdBy: actor.id, expiresAt });
    await audit(tx, actor.id, "coach.invited", { email, role });
  });
  const url = `${appUrl}/invite/${token}`;
  const emailed = emailEnabled()
    ? await sendEmail({
        to: email,
        subject: "You're invited to edit the GL Fencing planner",
        text: `${actor.name} invited you to plan practices on the GL Fencing planner.\n\nSet your password here (link expires in 7 days):\n${url}\n\nIf you weren't expecting this, you can ignore this email.`,
      })
    : false;
  return { url, expiresAt, emailed, email };
}

/**
 * Operator path (CLI with direct database access): create an invite link
 * without an existing administrator session. Used for break-glass recovery.
 */
export async function createInviteAsOperator(input: { email: string; role: Role; name?: string }, appUrl: string) {
  const email = parse(emailSchema, input.email);
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new AppError(409, "exists", "An account with this email already exists — use reset-link instead.");
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL).toISOString();
  await db.insert(authTokens).values({ kind: "invite", tokenHash: sha256Hex(token), email, role: input.role, name: input.name ?? "", expiresAt });
  await audit(db, null, "coach.invited", { email, role: input.role, by: "operator" });
  return { url: `${appUrl}/invite/${token}`, expiresAt };
}

export async function findUserByEmail(email: string) {
  const [u] = await getDb().select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return u ?? null;
}

export async function revokeInvite(actor: SessionUser, inviteId: string) {
  requireAdmin(actor);
  const db = getDb();
  await db.update(authTokens).set({ revokedAt: sql`now()` }).where(and(eq(authTokens.id, inviteId), eq(authTokens.kind, "invite")));
  await audit(db, actor.id, "coach.invite_revoked", { inviteId });
}

async function findValidToken(kind: "invite" | "reset", token: string) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const [row] = await getDb()
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, sha256Hex(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
        isNull(authTokens.revokedAt),
        gt(authTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getInvite(token: string) {
  const row = await findValidToken("invite", token);
  return row ? { email: row.email, role: row.role ?? "coach", name: row.name, expiresAt: row.expiresAt } : null;
}

export async function acceptInvite(
  token: string,
  input: { name: string; password: string },
  meta: RequestMeta,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  await enforceRateLimits([{ key: `token:ip:${meta.ip}`, limit: 30, windowSeconds: 3600 }]);
  const name = parse(nameSchema, input.name);
  const password = parse(passwordSchema, input.password);
  const passwordHash = await hashPassword(password);
  const db = getDb();
  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, sha256Hex(token)), eq(authTokens.kind, "invite")))
      .for("update")
      .limit(1);
    if (!row || row.usedAt || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
      throw new AppError(410, "invite_invalid", "This invite link is invalid or has expired. Ask your head coach for a new one.");
    }
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, row.email)).limit(1);
    if (existing) throw new AppError(409, "exists", "An account with this email already exists. Sign in instead.");
    const [created] = await tx
      .insert(users)
      .values({ email: row.email, name, role: row.role ?? "coach", passwordHash, passwordChangedAt: sql`now()` })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    await tx.update(authTokens).set({ usedAt: sql`now()` }).where(eq(authTokens.id, row.id));
    await audit(tx, created.id, "coach.invite_accepted", { email: row.email });
    return created;
  });
  const session = await createSession(user.id, meta.userAgent);
  return { user, ...session };
}

// ---------------------------------------------------------------------------
// Password resets
// ---------------------------------------------------------------------------
async function issueResetToken(userId: string, email: string, createdBy: string | null, ttl: number) {
  const token = generateToken();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(authTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(authTokens.kind, "reset"), eq(authTokens.userId, userId), isNull(authTokens.usedAt), isNull(authTokens.revokedAt)));
    await tx.insert(authTokens).values({
      kind: "reset",
      tokenHash: sha256Hex(token),
      email,
      userId,
      createdBy,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    });
  });
  return token;
}

/** Admin generates a reset link for a coach (shown on screen; emailed if SMTP is configured). */
export async function createResetLinkForUser(
  actor: SessionUser | null,
  userId: string,
  appUrl: string,
  opts: { email?: boolean; ttlHours?: number } = {},
): Promise<{ url: string; emailed: boolean; email: string; expiresAt: string }> {
  if (actor) requireAdmin(actor);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound("Coach not found.");
  const ttl = (opts.ttlHours ?? ADMIN_RESET_TTL / HOUR) * HOUR;
  const token = await issueResetToken(user.id, user.email, actor?.id ?? null, ttl);
  await audit(db, actor?.id ?? null, "coach.reset_link_created", { userId, by: actor ? "admin" : "cli/recovery" });
  const url = `${appUrl}/reset/${token}`;
  const emailed =
    opts.email && emailEnabled()
      ? await sendEmail({
          to: user.email,
          subject: "Reset your GL Fencing planner password",
          text: `A password reset was requested for your GL Fencing planner account.\n\nChoose a new password here:\n${url}\n\nIf you did not ask for this, ignore this email.`,
        })
      : false;
  return { url, emailed, email: user.email, expiresAt: new Date(Date.now() + ttl).toISOString() };
}

/** Self-service "forgot password". Only works when SMTP is configured. Never reveals whether an account exists. */
export async function requestPasswordReset(emailInput: string, meta: RequestMeta): Promise<{ emailEnabled: boolean }> {
  const enabled = emailEnabled();
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase().slice(0, 254) : "";
  await enforceRateLimits([
    { key: `forgot:ip:${meta.ip}`, limit: 10, windowSeconds: 3600 },
    { key: `forgot:email:${email}`, limit: 3, windowSeconds: 3600 },
  ]);
  if (!enabled || !email) return { emailEnabled: enabled };
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.disabledAt) {
    const token = await issueResetToken(user.id, user.email, null, SELF_RESET_TTL);
    await sendEmail({
      to: user.email,
      subject: "Reset your GL Fencing planner password",
      text: `Someone (hopefully you) asked to reset your GL Fencing planner password.\n\nThis link works for 1 hour:\n${meta.appUrl}/reset/${token}\n\nIf you didn't ask for this, ignore this email — your password won't change.`,
    });
  }
  return { emailEnabled: enabled };
}

export async function getReset(token: string) {
  const row = await findValidToken("reset", token);
  return row ? { email: row.email, expiresAt: row.expiresAt } : null;
}

export async function completeReset(
  token: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  await enforceRateLimits([{ key: `token:ip:${meta.ip}`, limit: 30, windowSeconds: 3600 }]);
  const password = parse(passwordSchema, newPassword);
  const passwordHash = await hashPassword(password);
  const db = getDb();
  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, sha256Hex(token)), eq(authTokens.kind, "reset")))
      .for("update")
      .limit(1);
    if (!row || !row.userId || row.usedAt || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
      throw new AppError(410, "reset_invalid", "This reset link is invalid or has expired. Ask your head coach for a new one.");
    }
    const [updated] = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, row.userId))
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, disabledAt: users.disabledAt });
    if (!updated || updated.disabledAt) throw new AppError(410, "reset_invalid", "This account is disabled.");
    await tx.update(authTokens).set({ usedAt: sql`now()` }).where(eq(authTokens.id, row.id));
    await audit(tx, updated.id, "auth.password_reset", {});
    return { id: updated.id, email: updated.email, name: updated.name, role: updated.role };
  });
  await invalidateUserSessions(user.id);
  const session = await createSession(user.id, meta.userAgent);
  return { user, ...session };
}

/**
 * Break-glass recovery: only enabled while the RECOVERY_TOKEN environment
 * variable is set (min. 24 chars). Produces a 1-hour reset link for an account.
 */
export async function recoverAccount(input: { recoveryToken: string; email: string }, meta: RequestMeta) {
  await enforceRateLimits([{ key: `recover:ip:${meta.ip}`, limit: 5, windowSeconds: 3600 }]);
  const expected = process.env.RECOVERY_TOKEN ?? "";
  if (expected.length < 24) throw new AppError(503, "recovery_disabled", "Recovery is disabled on this server.");
  if (!safeEqual(String(input.recoveryToken ?? "").trim(), expected)) throw forbidden("The recovery token is incorrect.");
  const email = parse(emailSchema, input.email);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw notFound("No account uses that email.");
  if (user.disabledAt) {
    await db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id));
  }
  await audit(db, null, "auth.recovery_used", { email });
  return createResetLinkForUser(null, user.id, meta.appUrl, { ttlHours: 1 });
}

// ---------------------------------------------------------------------------
// Account self-service and role management
// ---------------------------------------------------------------------------
export async function changePassword(actor: SessionUser, currentSessionId: string, current: string, next: string) {
  const password = parse(passwordSchema, next);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
  if (!user || !(await verifyPassword(String(current ?? ""), user.passwordHash))) {
    throw new AppError(400, "wrong_password", "Your current password is incorrect.");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(users.id, actor.id));
  await invalidateUserSessions(actor.id, currentSessionId);
  await audit(db, actor.id, "auth.password_changed", {});
}

export async function updateProfile(actor: SessionUser, input: { name: string }) {
  const name = parse(nameSchema, input.name);
  await getDb().update(users).set({ name, updatedAt: sql`now()` }).where(eq(users.id, actor.id));
}

async function adminCount(excludingUserId?: string): Promise<number> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.disabledAt)));
  return rows.filter((r) => r.id !== excludingUserId).length;
}

export async function setUserRole(actor: SessionUser, userId: string, role: Role) {
  requireAdmin(actor);
  if (role !== "admin" && role !== "coach") throw badRequest("Unknown role.");
  if (role === "coach" && (await adminCount(userId)) === 0) {
    throw new AppError(409, "last_admin", "There must always be at least one active administrator.");
  }
  const db = getDb();
  await db.update(users).set({ role, updatedAt: sql`now()` }).where(eq(users.id, userId));
  await audit(db, actor.id, "coach.role_changed", { userId, role });
}

export async function setUserDisabled(actor: SessionUser, userId: string, disabled: boolean) {
  requireAdmin(actor);
  if (disabled && userId === actor.id) throw new AppError(409, "self", "You cannot disable your own account.");
  if (disabled && (await adminCount(userId)) === 0) {
    throw new AppError(409, "last_admin", "There must always be at least one active administrator.");
  }
  const db = getDb();
  await db
    .update(users)
    .set({ disabledAt: disabled ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
  if (disabled) await invalidateUserSessions(userId);
  await audit(db, actor.id, disabled ? "coach.disabled" : "coach.enabled", { userId });
}
