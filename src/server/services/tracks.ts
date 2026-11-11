import "server-only";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db";
import { backupSlots, backupSnapshots, drills, eventRevisions, events, logicalEvents, phases, publicPhases, templates, trackBaselines, tracks } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { sanitizeLine } from "@/lib/text";
import type { EventDoc } from "@/lib/schemas";
import { publicToDoc } from "@/lib/fromPublic";
import { audit } from "@/server/audit";
import { liveRowsForSeason, lockSeason } from "@/server/live/store";
import { docToColumns, rowToDoc } from "./events";
import { getSettings } from "./settings";
import { MAX_BULK_ROWS, lockTrack, toTrackSummary, type TrackRow } from "./scope";
import { runOperation } from "./operations";
import { isUuid } from "./ids";

/** Usable capacity per season; three (A/B/C) is the documented minimum, not a hard schema limit. */
export const MAX_TRACKS_PER_SEASON = 12;

export type TrackMode = "empty" | "duplicate" | "published" | "backup";

function cleanName(name: unknown): string {
  const n = sanitizeLine(String(name ?? "")).trim().slice(0, 60);
  if (!n) throw badRequest("Give the track a name.");
  return n;
}

/** Next unused "Track X" name (A, B, C, … then numbers). */
export function suggestTrackName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!taken.has(`track ${letter.toLowerCase()}`)) return `Track ${letter}`;
  let i = 27;
  while (taken.has(`track ${i}`)) i++;
  return `Track ${i}`;
}

async function activeTracks(tx: Tx, seasonId: string): Promise<TrackRow[]> {
  return tx.select().from(tracks).where(and(eq(tracks.seasonId, seasonId), isNull(tracks.deletedAt))).orderBy(asc(tracks.sortOrder));
}

async function ensureNameFree(tx: Tx, seasonId: string, name: string, exceptId?: string) {
  const list = await activeTracks(tx, seasonId);
  if (list.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(409, "name_taken", `There is already a track named “${name}” in this season.`);
  }
  return list;
}

interface NewRow {
  doc: EventDoc;
  logicalId: string;
  timezone: string;
  externalRef?: string | null;
  isDemo?: boolean;
}

/** Bulk insert of working copies + one revision each, in the caller's transaction (atomic). */
async function insertRows(tx: Tx, actor: SessionUser | null, trackId: string, rows: NewRow[], action: string, summary: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const inserted = await tx
      .insert(events)
      .values(
        chunk.map((r) => ({
          ...docToColumns(r.doc),
          timezone: r.timezone,
          version: 1,
          trackId,
          logicalId: r.logicalId,
          externalRef: r.externalRef ?? null,
          isDemo: r.isDemo ?? false,
          createdBy: actor?.id ?? null,
          updatedBy: actor?.id ?? null,
        })),
      )
      .returning({ id: events.id });
    await tx.insert(eventRevisions).values(
      inserted.map((row, j) => ({ eventId: row.id, version: 1, action, summary, snapshot: chunk[j].doc, userId: actor?.id ?? null })),
    );
    ids.push(...inserted.map((r) => r.id));
  }
  return ids;
}

export interface CreateTrackInput {
  seasonId: string;
  name: string;
  description?: string;
  mode: TrackMode;
  sourceTrackId?: string | null;
  slot?: number | null;
  operationId?: string | null;
}

export async function createTrack(actor: SessionUser, input: CreateTrackInput) {
  if (!isUuid(input.seasonId)) throw notFound("Season not found.");
  const name = cleanName(input.name);
  const description = sanitizeLine(String(input.description ?? "")).slice(0, 500);
  if (!["empty", "duplicate", "published", "backup"].includes(input.mode)) throw badRequest("Unknown way to create a track.");
  const result = await runOperation(input.operationId, "create-track", actor, input.seasonId, async (tx) => {
    const season = await lockSeason(tx, input.seasonId);
    const list = await ensureNameFree(tx, season.id, name);
    if (list.length >= MAX_TRACKS_PER_SEASON) throw badRequest(`A season can have at most ${MAX_TRACKS_PER_SEASON} active tracks. Remove one first.`);
    const [{ m }] = await tx.select({ m: max(tracks.sortOrder) }).from(tracks).where(eq(tracks.seasonId, season.id));
    const settings = await getSettings(tx);
    let baselineGeneration = season.liveGeneration;
    let source: TrackRow | null = null;
    if (input.mode === "duplicate") {
      if (!input.sourceTrackId) throw badRequest("Choose the track to duplicate.");
      source = await lockTrack(tx, input.sourceTrackId);
      if (source.seasonId !== season.id) throw badRequest("You can only duplicate a track within the same season.");
      baselineGeneration = source.baselineGeneration;
    }
    let snapshot: typeof backupSnapshots.$inferSelect | null = null;
    if (input.mode === "backup") {
      const slot = Number(input.slot);
      const [s] = await tx
        .select({ snap: backupSnapshots, label: backupSlots.label })
        .from(backupSlots)
        .innerJoin(backupSnapshots, eq(backupSnapshots.id, backupSlots.snapshotId))
        .where(and(eq(backupSlots.seasonId, season.id), eq(backupSlots.slot, slot)))
        .limit(1);
      if (!s) throw notFound("That backup slot is empty.");
      snapshot = s.snap;
      baselineGeneration = s.snap.meta.liveGeneration;
    }
    const [track] = await tx
      .insert(tracks)
      .values({ seasonId: season.id, name, description, sortOrder: (m ?? 0) + 1, baselineGeneration, origin: input.mode, createdBy: actor.id })
      .returning();

    let count = 0;
    if (source) {
      // ---- faithful duplicate: every field, notes, assignments, status and confirmation kept
      const drillMap = new Map<string, string>();
      const localDrills = await tx.select().from(drills).where(and(eq(drills.trackId, source.id), isNull(drills.deletedAt)));
      for (const d of localDrills) {
        const rest: Partial<typeof d> = { ...d };
        delete rest.id;
        delete rest.createdAt;
        delete rest.updatedAt;
        const [copy] = await tx.insert(drills).values({ ...(rest as typeof drills.$inferInsert), trackId: track.id, clearBatchId: null, createdBy: actor.id, updatedBy: actor.id }).returning({ id: drills.id });
        drillMap.set(d.id, copy.id);
      }
      const localTemplates = await tx.select().from(templates).where(and(eq(templates.trackId, source.id), isNull(templates.deletedAt)));
      for (const t of localTemplates) {
        const rest: Partial<typeof t> = { ...t };
        delete rest.id;
        delete rest.createdAt;
        delete rest.updatedAt;
        const doc = { ...t.doc, blocks: t.doc.blocks.map((b) => (b.source && drillMap.has(b.source.drillId) ? { ...b, source: { ...b.source, drillId: drillMap.get(b.source.drillId)! } } : b)) };
        await tx.insert(templates).values({ ...(rest as typeof templates.$inferInsert), doc, trackId: track.id, clearBatchId: null, createdBy: actor.id, updatedBy: actor.id });
      }
      const srcRows = await tx.select().from(events).where(and(eq(events.trackId, source.id), isNull(events.deletedAt))).orderBy(asc(events.date));
      if (srcRows.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `Track has more than ${MAX_BULK_ROWS} events and cannot be duplicated in one step.`);
      const rows: NewRow[] = srcRows.map((r) => {
        const doc = rowToDoc(r);
        return {
          doc: { ...doc, blocks: doc.blocks.map((b) => (b.source && drillMap.has(b.source.drillId) ? { ...b, source: { ...b.source, drillId: drillMap.get(b.source.drillId)! } } : b)) },
          logicalId: r.logicalId,
          timezone: r.timezone,
          externalRef: r.externalRef,
          isDemo: r.isDemo,
        };
      });
      await insertRows(tx, actor, track.id, rows, "copy-track", `Copied from “${source.name}”`);
      count = rows.length;
      await tx.execute(sql`
        INSERT INTO track_baselines (track_id, logical_id, seen_generation)
        SELECT ${track.id}, logical_id, seen_generation FROM track_baselines WHERE track_id = ${source.id}`);
      const srcPhases = await tx.select().from(phases).where(and(eq(phases.trackId, source.id), isNull(phases.deletedAt)));
      if (srcPhases.length) {
        await tx.insert(phases).values(srcPhases.map((p) => ({ seasonId: p.seasonId, trackId: track.id, name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color, isDemo: p.isDemo })));
      }
    } else if (input.mode === "published") {
      // ---- only what is actually live: no private notes, nothing invented
      const live = await liveRowsForSeason(tx, season.id);
      const locIds = new Set((await tx.execute<{ id: string }>(sql`SELECT id FROM locations`)).rows.map((r) => r.id));
      const rows: NewRow[] = live.map((l) => ({
        doc: publicToDoc(l.payload, { locationId: l.locationId && locIds.has(l.locationId) ? l.locationId : null }),
        logicalId: l.logicalId,
        timezone: l.payload.timezone || settings.timezone,
      }));
      await insertRows(tx, actor, track.id, rows, "from-published", "Copied from the published schedule");
      count = rows.length;
      await tx.execute(sql`
        INSERT INTO track_baselines (track_id, logical_id, seen_generation)
        SELECT ${track.id}, id, live_generation FROM logical_events WHERE season_id = ${season.id} AND live_generation > 0`);
      const pp = await tx.select().from(publicPhases).where(eq(publicPhases.seasonId, season.id));
      if (pp.length) await tx.insert(phases).values(pp.map((p) => ({ seasonId: season.id, trackId: track.id, name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color })));
    } else if (snapshot) {
      // ---- a saved public backup becomes an editable draft track (public content only)
      const locIds = new Set((await tx.execute<{ id: string }>(sql`SELECT id FROM locations`)).rows.map((r) => r.id));
      const byName = new Map((await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM locations WHERE archived_at IS NULL`)).rows.map((r) => [r.name, r.id]));
      for (const e of snapshot.events) await tx.insert(logicalEvents).values({ id: e.logicalId, seasonId: season.id }).onConflictDoNothing();
      const rows: NewRow[] = snapshot.events.map((e) => {
        const locId = e.payload.location ? byName.get(e.payload.location.name) ?? null : null;
        return {
          doc: publicToDoc(e.payload, { locationId: locId && locIds.has(locId) ? locId : null }),
          logicalId: e.logicalId,
          timezone: e.payload.timezone || settings.timezone,
        };
      });
      await insertRows(tx, actor, track.id, rows, "from-backup", "Loaded from a saved public backup");
      count = rows.length;
      if (snapshot.phases?.length) {
        await tx.insert(phases).values(snapshot.phases.map((p) => ({ seasonId: season.id, trackId: track.id, name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color })));
      }
    }
    await audit(tx, actor.id, "track.created", { trackId: track.id, seasonId: season.id, mode: input.mode, events: count });
    return { trackId: track.id, events: count };
  });
  return result;
}

export async function updateTrack(actor: SessionUser, id: string, input: { name?: string; description?: string; sortOrder?: number }) {
  if (!isUuid(id)) throw notFound("That planning track no longer exists.");
  return getDb().transaction(async (tx) => {
    const t = await lockTrack(tx, id);
    const patch: Partial<typeof tracks.$inferInsert> = { updatedAt: sql`now()` as unknown as string };
    if (input.name !== undefined) {
      patch.name = cleanName(input.name);
      await ensureNameFree(tx, t.seasonId, patch.name, t.id);
    }
    if (input.description !== undefined) patch.description = sanitizeLine(String(input.description)).slice(0, 500);
    if (input.sortOrder !== undefined && Number.isInteger(input.sortOrder)) patch.sortOrder = input.sortOrder;
    const [row] = await tx.update(tracks).set(patch).where(eq(tracks.id, id)).returning();
    return toTrackSummary(row);
  });
}

/** Reversible: the track (with all its rows) goes to Trash. The public schedule is not affected. */
export async function removeTrack(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("That planning track no longer exists.");
  await getDb().transaction(async (tx) => {
    const t = await lockTrack(tx, id);
    const list = await activeTracks(tx, t.seasonId);
    if (list.length <= 1) throw badRequest("A season needs at least one planning track. Create another track before removing this one.");
    await tx.update(tracks).set({ deletedAt: sql`now()`, deletedBy: actor.id, updatedAt: sql`now()` }).where(eq(tracks.id, id));
    await audit(tx, actor.id, "track.removed", { trackId: id, seasonId: t.seasonId });
  });
}

export async function restoreTrack(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("That planning track no longer exists.");
  return getDb().transaction(async (tx) => {
    const [t] = await tx.select().from(tracks).where(eq(tracks.id, id)).for("update").limit(1);
    if (!t) throw notFound("That planning track no longer exists.");
    if (!t.deletedAt) return toTrackSummary(t);
    const list = await activeTracks(tx, t.seasonId);
    let name = t.name;
    let n = 1;
    while (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${t.name} (restored${n++ > 1 ? ` ${n - 1}` : ""})`;
    const [row] = await tx.update(tracks).set({ deletedAt: null, deletedBy: null, name, updatedAt: sql`now()` }).where(eq(tracks.id, id)).returning();
    await audit(tx, actor.id, "track.restored", { trackId: id, renamed: name !== t.name });
    return toTrackSummary(row);
  });
}

export { trackBaselines };
