import "server-only";
import { and, asc, between, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { publicEvents, publicPhases, publishLog, seasons } from "@/server/db/schema";
import type { PublicEvent } from "@/lib/projection";
import { addDays, diffDays, isISODate, nowTimeInTimeZone, todayInTimeZone } from "@/lib/dates";
import { getSettings } from "./settings";
import { isUuid } from "./ids";

/**
 * PUBLIC READ MODEL.
 * Every function here reads only `public_events` (sanitized projections),
 * `public_phases` (published phases), public season display fields, team
 * settings, and the latest publish-log note. It must never import or query the
 * private `events`/`event_revisions`/`phases`/`tracks`/backup tables.
 *
 * `publicSnapshot` runs several reads in ONE read-only repeatable-read
 * transaction so a page never mixes the states before and after a replacement.
 */
export function publicSnapshot<T>(fn: (db: DbOrTx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => fn(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export interface PublicMeta {
  teamName: string;
  shortName: string;
  publicIntro: string;
  timezone: string;
  lastUpdatedAt: string | null;
  lastNote: string;
  lastNoteAt: string | null;
}

export interface PublicPhase {
  id: string;
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
  color: string;
}

export interface PublicSeason {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  phases: PublicPhase[];
}

export async function getPublicMeta(db: DbOrTx = getDb()): Promise<PublicMeta> {
  const settings = await getSettings(db);
  const [latest] = await db.select().from(publishLog).orderBy(desc(publishLog.createdAt)).limit(1);
  // Only the LATEST change's note is shown (and only for 30 days): an older note never
  // describes a schedule that was replaced or restored afterwards.
  const noteRow = latest && latest.note && latest.createdAt >= addDaysIso(-30) ? latest : null;
  return {
    teamName: settings.teamName,
    shortName: settings.shortName,
    publicIntro: settings.publicIntro,
    timezone: settings.timezone,
    lastUpdatedAt: latest?.createdAt ?? null,
    lastNote: noteRow?.note ?? "",
    lastNoteAt: noteRow?.createdAt ?? null,
  };
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export async function getPublicEvents(from: string, to: string, db: DbOrTx = getDb()): Promise<PublicEvent[]> {
  if (!isISODate(from) || !isISODate(to) || diffDays(from, to) > 400 || diffDays(from, to) < 0) return [];
  const rows = await db
    .select({ payload: publicEvents.payload })
    .from(publicEvents)
    .where(between(publicEvents.date, from, to))
    .orderBy(asc(publicEvents.date), asc(publicEvents.startTime));
  return rows.map((r) => r.payload);
}

/** One event by its permanent LOGICAL id (the /e/<id> link). */
export async function getPublicEvent(id: string, db: DbOrTx = getDb()): Promise<PublicEvent | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select({ payload: publicEvents.payload }).from(publicEvents).where(eq(publicEvents.logicalId, id)).limit(1);
  return row?.payload ?? null;
}

/**
 * Today's events (if any are still upcoming or in progress) or the next
 * scheduled event. Canceled events are reported but not chosen as "next".
 */
export async function getNextUp(timezone: string, now: Date = new Date(), db: DbOrTx = getDb()): Promise<{ today: PublicEvent[]; next: PublicEvent | null; todayDate: string }> {
  const todayDate = todayInTimeZone(timezone, now);
  const time = nowTimeInTimeZone(timezone, now);
  const upcoming = await getPublicEvents(todayDate, addDays(todayDate, 120), db);
  const today = upcoming.filter((e) => e.date === todayDate);
  // An event "is still on" if it is later than today, or today and not yet over.
  const stillOn = (e: PublicEvent) => e.status !== "canceled" && (e.date > todayDate || !e.endTime || e.endTime > time);
  const next = upcoming.find(stillOn) ?? null;
  return { today, next, todayDate };
}

export async function getPublicSeasons(db: DbOrTx = getDb()): Promise<PublicSeason[]> {
  const s = await db
    .select({ id: seasons.id, name: seasons.name, startDate: seasons.startDate, endDate: seasons.endDate })
    .from(seasons)
    .where(eq(seasons.publicVisible, true))
    .orderBy(asc(seasons.startDate));
  if (s.length === 0) return [];
  const p = await db
    .select()
    .from(publicPhases)
    .where(inArray(publicPhases.seasonId, s.map((x) => x.id)))
    .orderBy(asc(publicPhases.startDate));
  return s.map((season) => ({
    id: season.id,
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    phases: p
      .filter((ph) => ph.seasonId === season.id)
      .map((ph) => ({ id: ph.id, seasonId: ph.seasonId, name: ph.name, startDate: ph.startDate, endDate: ph.endDate, focus: ph.focus, color: ph.color })),
  }));
}

/** PUBLISHED phases overlapping a range (coach planning pages use their track's phases instead). */
export async function getPhasesInRange(from: string, to: string, db: DbOrTx = getDb()): Promise<PublicPhase[]> {
  const rows = await db
    .select()
    .from(publicPhases)
    .where(and(lte(publicPhases.startDate, to), gte(publicPhases.endDate, from)))
    .orderBy(asc(publicPhases.startDate));
  return rows.map((ph) => ({ id: ph.id, seasonId: ph.seasonId, name: ph.name, startDate: ph.startDate, endDate: ph.endDate, focus: ph.focus, color: ph.color }));
}

export function phaseForDate(list: readonly PublicPhase[], date: string): PublicPhase | null {
  return list.find((p) => p.startDate <= date && p.endDate >= date) ?? null;
}
