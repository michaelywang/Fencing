import "server-only";
import { and, asc, between, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getDb } from "@/server/db";
import { phases, publicEvents, publishLog, seasons } from "@/server/db/schema";
import type { PublicEvent } from "@/lib/projection";
import { addDays, diffDays, isISODate, nowTimeInTimeZone, todayInTimeZone } from "@/lib/dates";
import { getSettings } from "./settings";
import { isUuid } from "./events";

/**
 * PUBLIC READ MODEL.
 * Every function here reads only `public_events` (sanitized projections),
 * seasons/phases (public by design), team settings, and the publish log note.
 * It must never import or query the private `events`/`event_revisions` tables.
 */

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

export async function getPublicMeta(): Promise<PublicMeta> {
  const db = getDb();
  const settings = await getSettings(db);
  const [latest] = await db.select().from(publishLog).orderBy(desc(publishLog.createdAt)).limit(1);
  // Most recent non-empty change note from the last 30 days.
  const [noteRow] = await db
    .select()
    .from(publishLog)
    .where(and(gte(publishLog.createdAt, addDaysIso(-30)), ne(publishLog.note, "")))
    .orderBy(desc(publishLog.createdAt))
    .limit(1);
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

export async function getPublicEvents(from: string, to: string): Promise<PublicEvent[]> {
  if (!isISODate(from) || !isISODate(to) || diffDays(from, to) > 400 || diffDays(from, to) < 0) return [];
  const rows = await getDb()
    .select({ payload: publicEvents.payload })
    .from(publicEvents)
    .where(between(publicEvents.date, from, to))
    .orderBy(asc(publicEvents.date), asc(publicEvents.startTime));
  return rows.map((r) => r.payload);
}

export async function getPublicEvent(id: string): Promise<PublicEvent | null> {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select({ payload: publicEvents.payload }).from(publicEvents).where(eq(publicEvents.eventId, id)).limit(1);
  return row?.payload ?? null;
}

/**
 * Today's events (if any are still upcoming or in progress) or the next
 * scheduled event. Canceled events are reported but not chosen as "next".
 */
export async function getNextUp(timezone: string, now: Date = new Date()): Promise<{ today: PublicEvent[]; next: PublicEvent | null; todayDate: string }> {
  const todayDate = todayInTimeZone(timezone, now);
  const time = nowTimeInTimeZone(timezone, now);
  const upcoming = await getPublicEvents(todayDate, addDays(todayDate, 120));
  const today = upcoming.filter((e) => e.date === todayDate);
  // An event "is still on" if it is later than today, or today and not yet over.
  const stillOn = (e: PublicEvent) => e.status !== "canceled" && (e.date > todayDate || !e.endTime || e.endTime > time);
  const next = upcoming.find(stillOn) ?? null;
  return { today, next, todayDate };
}

export async function getPublicSeasons(): Promise<PublicSeason[]> {
  const db = getDb();
  const s = await db.select().from(seasons).orderBy(asc(seasons.startDate));
  if (s.length === 0) return [];
  const p = await db
    .select()
    .from(phases)
    .where(inArray(phases.seasonId, s.map((x) => x.id)))
    .orderBy(asc(phases.startDate));
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

export async function getPhasesInRange(from: string, to: string): Promise<PublicPhase[]> {
  const rows = await getDb()
    .select()
    .from(phases)
    .where(and(lte(phases.startDate, to), gte(phases.endDate, from)))
    .orderBy(asc(phases.startDate));
  return rows.map((ph) => ({ id: ph.id, seasonId: ph.seasonId, name: ph.name, startDate: ph.startDate, endDate: ph.endDate, focus: ph.focus, color: ph.color }));
}

export function phaseForDate(list: readonly PublicPhase[], date: string): PublicPhase | null {
  return list.find((p) => p.startDate <= date && p.endDate >= date) ?? null;
}
