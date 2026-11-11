import "server-only";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { events, seasons, tracks } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/errors";
import { isISODate } from "@/lib/dates";
import { EVENT_KINDS, type EventKind } from "@/lib/constants";
import type { LiveScope } from "@/lib/liveTypes";
import { isUuid } from "./ids";

export type SeasonRow = typeof seasons.$inferSelect;
export type TrackRow = typeof tracks.$inferSelect;

export interface TrackSummary {
  id: string;
  seasonId: string;
  name: string;
  description: string;
  sortOrder: number;
  origin: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  eventCount: number;
}

export interface SeasonSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isDemo: boolean;
  publicVisible: boolean;
  liveGeneration: number;
  liveUpdatedAt: string | null;
  tracks: TrackSummary[];
}

/** All seasons with their ACTIVE tracks and active event counts (coach-only data). */
export async function listWorkspaces(db: DbOrTx = getDb()): Promise<SeasonSummary[]> {
  const s = await db.select().from(seasons).orderBy(desc(seasons.startDate), asc(seasons.name));
  const t = await db
    .select({
      track: tracks,
      eventCount: sql<number>`(SELECT count(*)::int FROM ${events} e WHERE e.track_id = ${tracks.id} AND e.deleted_at IS NULL)`,
    })
    .from(tracks)
    .where(isNull(tracks.deletedAt))
    .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));
  return s.map((season) => ({
    id: season.id,
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    isDemo: season.isDemo,
    publicVisible: season.publicVisible,
    liveGeneration: season.liveGeneration,
    liveUpdatedAt: season.liveUpdatedAt,
    tracks: t.filter((x) => x.track.seasonId === season.id).map((x) => toTrackSummary(x.track, x.eventCount)),
  }));
}

export function toTrackSummary(t: TrackRow, eventCount = 0): TrackSummary {
  return {
    id: t.id,
    seasonId: t.seasonId,
    name: t.name,
    description: t.description,
    sortOrder: t.sortOrder,
    origin: t.origin,
    isDemo: t.isDemo,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    deletedAt: t.deletedAt,
    eventCount,
  };
}

export async function getSeason(id: string, db: DbOrTx = getDb()): Promise<SeasonRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
  return row ?? null;
}

export async function getTrack(id: string, db: DbOrTx = getDb()): Promise<TrackRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
  return row ?? null;
}

/** Throws unless the track exists and has not been removed. */
export async function requireActiveTrack(id: string | null | undefined, db: DbOrTx = getDb()): Promise<TrackRow> {
  if (!id) throw badRequest("Choose a planning track.");
  const t = await getTrack(id, db);
  if (!t) throw notFound("That planning track no longer exists.");
  if (t.deletedAt) throw new AppError(409, "track_removed", `“${t.name}” was removed. Restore it from Trash to edit it.`);
  return t;
}

/** Locks a track row (serializes bulk operations on one track). */
export async function lockTrack(tx: Tx, id: string): Promise<TrackRow> {
  if (!isUuid(id)) throw notFound("That planning track no longer exists.");
  const [t] = await tx.select().from(tracks).where(eq(tracks.id, id)).for("update").limit(1);
  if (!t) throw notFound("That planning track no longer exists.");
  if (t.deletedAt) throw new AppError(409, "track_removed", `“${t.name}” was removed. Restore it from Trash to edit it.`);
  return t;
}

/** The workspace shown by default: the season containing today, else the next one, else the latest. Demo seasons last. */
export function pickDefaultSeason<T extends { startDate: string; endDate: string; isDemo: boolean; tracks: unknown[] }>(list: T[], today: string): T | null {
  const usable = list.filter((s) => s.tracks.length > 0);
  const ordered = [...usable.filter((s) => !s.isDemo), ...usable.filter((s) => s.isDemo)];
  return (
    ordered.find((s) => s.startDate <= today && s.endDate >= today) ??
    ordered.filter((s) => s.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ??
    ordered.sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
    null
  );
}

/**
 * Resolves the track a coach page should show. The selection lives in the URL
 * (per tab); when it is missing or stale we fall back to the default season's
 * first track. Nothing here is stored server-side per user.
 */
export async function resolveTrackSelection(trackParam: string | null | undefined, today: string, db: DbOrTx = getDb()) {
  const workspaces = await listWorkspaces(db);
  let season = null as SeasonSummary | null;
  let track = null as TrackSummary | null;
  let stale = false;
  if (trackParam) {
    for (const s of workspaces) {
      const t = s.tracks.find((x) => x.id === trackParam);
      if (t) {
        season = s;
        track = t;
      }
    }
    if (!track) stale = true;
  }
  if (!track) {
    season = pickDefaultSeason(workspaces, today);
    track = season?.tracks[0] ?? null;
  }
  return { workspaces, season, track, stale };
}

export interface ScopeInput {
  from?: string | null;
  to?: string | null;
  kinds?: string[] | null;
}

/** Validates a scope. Dates are optional; null means the season's full span (every date). */
export function parseScope(seasonId: string, input: ScopeInput | null | undefined): LiveScope {
  const from = input?.from || null;
  const to = input?.to || null;
  if (from && !isISODate(from)) throw badRequest("Invalid start date for the scope.");
  if (to && !isISODate(to)) throw badRequest("Invalid end date for the scope.");
  if (from && to && to < from) throw badRequest("The scope's end date is before its start date.");
  let kinds: EventKind[] | null = null;
  if (input?.kinds && input.kinds.length) {
    const bad = input.kinds.filter((k) => !(EVENT_KINDS as readonly string[]).includes(k));
    if (bad.length) throw badRequest(`Unknown event type: ${bad.join(", ")}`);
    kinds = [...new Set(input.kinds)] as EventKind[];
    if (kinds.length === EVENT_KINDS.length) kinds = null;
  }
  return { seasonId, from, to, kinds };
}

/** Maximum rows a single bulk request will touch (a full season is ~150–300 events). */
export const MAX_BULK_ROWS = 2000;
