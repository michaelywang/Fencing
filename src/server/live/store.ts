import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/server/db";
import { eventPublications, logicalEvents, publicEvents, publicPhases, publishLog, seasons } from "@/server/db/schema";
import type { PublicEvent } from "@/lib/projection";
import type { EventDoc } from "@/lib/schemas";
import { phaseOverlapsScope, scopeIncludes, type BackupPhase, type LiveScope } from "@/lib/liveTypes";
import { notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";

export type SeasonRow = typeof seasons.$inferSelect;
export type LiveRow = typeof publicEvents.$inferSelect;

/**
 * Serializes every change to one season's live schedule. All live writes take
 * this row lock first, so generations are strictly increasing and two coaches
 * (or a retry) can never interleave a replacement, restore or slot swap.
 */
export async function lockSeason(tx: Tx, seasonId: string): Promise<SeasonRow> {
  const [s] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update").limit(1);
  if (!s) throw notFound("That season no longer exists.");
  return s;
}

/** Allocates the next live generation for this operation (one per operation, not per event). */
export async function bumpGeneration(tx: Tx, season: SeasonRow): Promise<number> {
  const gen = season.liveGeneration + 1;
  await tx.update(seasons).set({ liveGeneration: gen, liveUpdatedAt: sql`now()` }).where(eq(seasons.id, season.id));
  season.liveGeneration = gen;
  return gen;
}

export async function liveRowsForSeason(db: DbOrTx, seasonId: string): Promise<LiveRow[]> {
  return db.select().from(publicEvents).where(eq(publicEvents.seasonId, seasonId)).orderBy(asc(publicEvents.date), asc(publicEvents.startTime));
}

export async function liveRowsInScope(db: DbOrTx, scope: LiveScope): Promise<LiveRow[]> {
  const all = await liveRowsForSeason(db, scope.seasonId);
  return all.filter((r) => scopeIncludes(scope, { date: r.date, kind: r.kind }));
}

export async function liveRow(db: DbOrTx, logicalId: string): Promise<LiveRow | null> {
  const [r] = await db.select().from(publicEvents).where(eq(publicEvents.logicalId, logicalId)).limit(1);
  return r ?? null;
}

export async function logicalGenerations(db: DbOrTx, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: logicalEvents.id, gen: logicalEvents.liveGeneration }).from(logicalEvents).where(inArray(logicalEvents.id, ids));
  return new Map(rows.map((r) => [r.id, r.gen]));
}

export interface LiveWrite {
  logicalId: string;
  /** New public payload, or null to remove the event from the live schedule. */
  payload: PublicEvent | null;
  sourceRowId?: string | null;
  sourceTrackId?: string | null;
  sourceVersion?: number;
  locationId?: string | null;
  /** Private working copy that was published (provenance only; never public). */
  snapshot?: EventDoc | null;
}

export interface LiveWriteMeta {
  action: string;
  actor: SessionUser | null;
  operationId?: string | null;
}

/** Applies one live change and records event-level provenance. Caller holds the season lock. */
export async function writeLive(tx: Tx, season: SeasonRow, gen: number, w: LiveWrite, meta: LiveWriteMeta): Promise<string> {
  const [prev] = await tx.select().from(publicEvents).where(eq(publicEvents.logicalId, w.logicalId)).limit(1);
  await tx.insert(logicalEvents).values({ id: w.logicalId, seasonId: season.id }).onConflictDoNothing();
  if (w.payload) {
    const p = w.payload;
    const values = {
      seasonId: season.id,
      date: p.date,
      startTime: p.startTime,
      kind: p.kind,
      status: p.status,
      payload: p,
      sourceVersion: w.sourceVersion ?? prev?.sourceVersion ?? 0,
      sourceRowId: w.sourceRowId ?? null,
      sourceTrackId: w.sourceTrackId ?? null,
      locationId: w.locationId ?? null,
      changedGeneration: gen,
      publishedAt: p.publishedAt,
      publishedBy: meta.actor?.id ?? null,
    };
    await tx
      .insert(publicEvents)
      .values({ logicalId: w.logicalId, ...values })
      .onConflictDoUpdate({ target: publicEvents.logicalId, set: values });
  } else if (prev) {
    await tx.delete(publicEvents).where(eq(publicEvents.logicalId, w.logicalId));
  }
  await tx
    .update(logicalEvents)
    .set({ liveGeneration: gen, livePresent: w.payload !== null })
    .where(eq(logicalEvents.id, w.logicalId));
  const [pub] = await tx.insert(eventPublications).values({
    seasonId: season.id,
    logicalId: w.logicalId,
    sourceRowId: w.sourceRowId ?? null,
    sourceTrackId: w.sourceTrackId ?? null,
    action: meta.action,
    generation: gen,
    snapshot: w.snapshot ?? null,
    previousPayload: prev?.payload ?? null,
    payload: w.payload,
    operationId: meta.operationId ?? null,
    userId: meta.actor?.id ?? null,
  }).returning({ id: eventPublications.id });
  return pub.id;
}

/**
 * Records one live operation. `publicNote` is what students see next to
 * "last updated"; it describes THIS change only (older notes are never shown
 * once a newer operation happens).
 */
export async function logLive(
  tx: Tx,
  season: SeasonRow,
  input: { action: string; actor: SessionUser | null; publicNote?: string; count: number; operationId?: string | null; details?: Record<string, unknown> },
) {
  await tx.insert(publishLog).values({
    userId: input.actor?.id ?? null,
    action: input.action,
    note: (input.publicNote ?? "").slice(0, 280),
    eventCount: input.count,
    seasonId: season.id,
    operationId: input.operationId ?? null,
    details: input.details ?? null,
  });
}

export async function publicPhasesInScope(db: DbOrTx, scope: LiveScope): Promise<Array<typeof publicPhases.$inferSelect>> {
  const rows = await db.select().from(publicPhases).where(eq(publicPhases.seasonId, scope.seasonId)).orderBy(asc(publicPhases.startDate));
  return rows.filter((p) => phaseOverlapsScope(scope, p));
}

/** Replaces the public phases overlapping a scope (whole season when the scope is unbounded). */
export async function replacePublicPhases(tx: Tx, scope: LiveScope, next: BackupPhase[]) {
  const current = await publicPhasesInScope(tx, scope);
  if (current.length) await tx.delete(publicPhases).where(and(eq(publicPhases.seasonId, scope.seasonId), inArray(publicPhases.id, current.map((p) => p.id))));
  if (next.length) {
    await tx.insert(publicPhases).values(
      next.map((p) => ({ seasonId: scope.seasonId, name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color })),
    );
  }
}

export const phaseKey = (p: BackupPhase) => `${p.startDate}|${p.endDate}|${p.name}|${p.color}|${p.focus}`;

/**
 * Removes many live events in one operation (3 statements, not one round trip
 * per event) with event-level provenance. Caller holds the season lock.
 */
export async function removeLiveBulk(tx: Tx, season: SeasonRow, gen: number, rows: LiveRow[], meta: LiveWriteMeta): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const ids = chunk.map((r) => r.logicalId);
    await tx.insert(eventPublications).values(
      chunk.map((r) => ({
        seasonId: season.id,
        logicalId: r.logicalId,
        sourceRowId: null,
        sourceTrackId: null,
        action: meta.action,
        generation: gen,
        snapshot: null,
        previousPayload: r.payload,
        payload: null,
        operationId: meta.operationId ?? null,
        userId: meta.actor?.id ?? null,
      })),
    );
    await tx.delete(publicEvents).where(inArray(publicEvents.logicalId, ids));
    await tx.update(logicalEvents).set({ liveGeneration: gen, livePresent: false }).where(inArray(logicalEvents.id, ids));
  }
}
