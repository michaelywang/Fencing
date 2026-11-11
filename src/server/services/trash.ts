import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { clearBatches, drills, eventRevisions, events, logicalEvents, phases, publicEvents, templates, tracks, users } from "@/server/db/schema";
import { AppError, badRequest, forbidden, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import type { PublicEvent } from "@/lib/projection";
import { displayTitle } from "@/lib/practice";
import { phaseOverlapsScope, scopeIncludes, type LiveScope } from "@/lib/liveTypes";
import { todayInTimeZone } from "@/lib/dates";
import { audit } from "@/server/audit";
import { canonicalJson, publicContentHash, sha256 } from "@/server/live/hash";
import { bumpGeneration, liveRowsInScope, lockSeason, logLive, publicPhasesInScope, removeLiveBulk, replacePublicPhases, writeLive } from "@/server/live/store";
import { recordRevision, rowToDoc, selectRecords, setBaselines, type EventRow } from "./events";
import { getSettings } from "./settings";
import { MAX_BULK_ROWS, getSeason, getTrack, lockTrack, parseScope, type ScopeInput } from "./scope";
import { backupBeforeLiveChange, slotPlan } from "./backups";
import type { BackupPlan } from "./publishing";
import { runOperation } from "./operations";
import { isUuid } from "./ids";

// ---------------------------------------------------------------------------
// Clear schedule (one dialog: track only / published only / both)
// ---------------------------------------------------------------------------
export type ClearTarget = "track" | "public" | "both";

export interface ClearRequest {
  trackId: string;
  target: ClearTarget;
  /** null/empty = the ENTIRE season (every month), never the visible month. */
  scope?: ScopeInput | null;
  includePhases?: boolean;
  /** Track-local drills and templates (never the shared library). */
  includeResources?: boolean;
}

export interface ClearPreview {
  target: ClearTarget;
  seasonId: string;
  seasonName: string;
  trackId: string;
  trackName: string;
  scope: LiveScope;
  private: { events: number; published: number; changed: number; drafts: number; past: number; completedNotes: number; phases: number; drills: number; templates: number } | null;
  public: { events: number; phases: number; outOfScope: number } | null;
  backup: BackupPlan | null;
  token: string;
}

async function computeClear(db: DbOrTx, req: ClearRequest, lock: boolean) {
  if (!["track", "public", "both"].includes(req.target)) throw badRequest("Choose what to clear.");
  const track = await getTrack(req.trackId, db);
  if (!track) throw notFound("That planning track no longer exists.");
  if (track.deletedAt && req.target !== "public") throw new AppError(409, "track_removed", `“${track.name}” was removed.`);
  const season = await getSeason(track.seasonId, db);
  if (!season) throw notFound("Season not found.");
  const scope = parseScope(season.id, req.scope);
  const settings = await getSettings(db);
  const today = todayInTimeZone(settings.timezone);
  const doPrivate = req.target !== "public";
  const doPublic = req.target !== "track";

  let rows: EventRow[] = [];
  let records: Awaited<ReturnType<typeof selectRecords>> = [];
  let phaseIds: string[] = [];
  let drillIds: string[] = [];
  let templateIds: string[] = [];
  if (doPrivate) {
    let q = db.select().from(events).where(and(eq(events.trackId, track.id), isNull(events.deletedAt))).orderBy(asc(events.id)).$dynamic();
    if (lock) q = q.for("update");
    rows = (await q).filter((r) => scopeIncludes(scope, r));
    if (rows.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `More than ${MAX_BULK_ROWS} events are in this scope; clear a smaller date range at a time.`);
    records = rows.length ? await selectRecords(db, inArray(events.id, rows.map((r) => r.id))) : [];
    if (req.includePhases) {
      const ph = await db.select().from(phases).where(and(eq(phases.trackId, track.id), isNull(phases.deletedAt)));
      phaseIds = ph.filter((p) => phaseOverlapsScope(scope, p)).map((p) => p.id).sort();
    }
    if (req.includeResources) {
      drillIds = (await db.select({ id: drills.id }).from(drills).where(and(eq(drills.trackId, track.id), isNull(drills.deletedAt)))).map((d) => d.id).sort();
      templateIds = (await db.select({ id: templates.id }).from(templates).where(and(eq(templates.trackId, track.id), isNull(templates.deletedAt)))).map((d) => d.id).sort();
    }
  }
  const live = doPublic ? await liveRowsInScope(db, scope) : [];
  const livePhases = doPublic && req.includePhases ? await publicPhasesInScope(db, scope) : [];
  const allLive = doPublic ? (await db.select({ n: sql<number>`count(*)::int` }).from(publicEvents).where(eq(publicEvents.seasonId, season.id)))[0].n : 0;
  if (live.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `More than ${MAX_BULK_ROWS} published events are in this scope; clear a smaller date range at a time.`);

  let backup: BackupPlan | null = null;
  if (doPublic && (live.length || livePhases.length)) {
    const plan = await slotPlan(db, season.id);
    backup = {
      required: true,
      slots: plan.slots.map((s) => (s ? { slot: s.slot, label: s.label, createdAt: s.createdAt, eventCount: s.eventCount, dateFrom: s.dateFrom, dateTo: s.dateTo, reason: s.reason } : null)),
      firstEmpty: plan.firstEmpty,
    };
  }
  const preview: ClearPreview = {
    target: req.target,
    seasonId: season.id,
    seasonName: season.name,
    trackId: track.id,
    trackName: track.name,
    scope,
    private: doPrivate
      ? {
          events: rows.length,
          published: records.filter((r) => r.publication === "published").length,
          changed: records.filter((r) => r.publication === "changed").length,
          drafts: records.filter((r) => r.publication === "draft").length,
          past: rows.filter((r) => r.date < today).length,
          completedNotes: rows.filter((r) => r.completedNotes.trim()).length,
          phases: phaseIds.length,
          drills: drillIds.length,
          templates: templateIds.length,
        }
      : null,
    public: doPublic ? { events: live.length, phases: livePhases.length, outOfScope: allLive - live.length } : null,
    backup,
    token: sha256(
      canonicalJson({
        t: req.target,
        scope,
        rows: rows.map((r) => [r.id, r.version]),
        live: live.map((l) => [l.logicalId, publicContentHash(l.payload)]).sort(),
        lp: livePhases.map((p) => p.id).sort(),
        phaseIds,
        drillIds,
        templateIds,
      }),
    ),
  };
  return { preview, season, track, scope, rows, live, livePhases, phaseIds, drillIds, templateIds };
}

export async function previewClear(req: ClearRequest): Promise<ClearPreview> {
  if (!isUuid(req.trackId)) throw badRequest("Choose a planning track.");
  return (await computeClear(getDb(), req, false)).preview;
}

export async function executeClear(actor: SessionUser, req: ClearRequest & { token: string; slot?: number | null; operationId?: string | null }) {
  if (!isUuid(req.trackId)) throw badRequest("Choose a planning track.");
  const t = await getTrack(req.trackId);
  if (!t) throw notFound("That planning track no longer exists.");
  return runOperation(req.operationId, "clear", actor, t.seasonId, async (tx) => {
    const season = await lockSeason(tx, t.seasonId);
    if (req.target !== "public") await lockTrack(tx, t.id);
    const c = await computeClear(tx, req, true);
    if (!req.token || req.token !== c.preview.token) {
      throw new AppError(409, "review_stale", "The schedule changed since you previewed this clear. Check the new counts and try again.", { preview: c.preview });
    }
    const nothing = c.rows.length + c.live.length + c.livePhases.length + c.phaseIds.length + c.drillIds.length + c.templateIds.length === 0;
    if (nothing) return { noop: true, batchId: null as string | null, backupSlot: null as number | null, counts: {} as Record<string, number> };

    const clearedLive = new Set(c.live.map((l) => l.logicalId));
    let backupSlot: number | null = null;
    let backupSnapshotId: string | null = null;
    const counts: Record<string, number> = {
      events: c.rows.length,
      phases: c.phaseIds.length,
      drills: c.drillIds.length,
      templates: c.templateIds.length,
      publicEvents: c.live.length,
      publicPhases: c.livePhases.length,
    };
    const [batch] = await tx
      .insert(clearBatches)
      .values({
        seasonId: season.id,
        trackId: req.target === "public" ? null : t.id,
        userId: actor.id,
        target: req.target,
        scope: c.scope,
        counts,
        items: { events: c.rows.map((r) => r.id), phases: c.phaseIds, drills: c.drillIds, templates: c.templateIds },
        operationId: req.operationId ?? null,
      })
      .returning({ id: clearBatches.id });

    // 1) private rows → Trash (whole documents, notes and blocks included). Versions move
    //    forward so a delayed pre-clear autosave is rejected even after a restore.
    if (c.rows.length) {
      const ids = c.rows.map((r) => r.id);
      const liveIds = [...clearedLive];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await tx.execute(sql`
          UPDATE events e SET
            deleted_at = now(), deleted_by = ${actor.id}, clear_batch_id = ${batch.id}, version = e.version + 1,
            deleted_public_payload = CASE WHEN e.logical_id = ANY(${sql.raw(`'{${liveIds.join(",")}}'`)}::uuid[])
              THEN (SELECT p.payload FROM public_events p WHERE p.event_id = e.logical_id) ELSE NULL END
          WHERE e.id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`);
      }
      for (let i = 0; i < c.rows.length; i += 200) {
        await tx.insert(eventRevisions).values(
          c.rows.slice(i, i + 200).map((r) => ({
            eventId: r.id,
            version: r.version + 1,
            action: "clear",
            summary: req.target === "both" && clearedLive.has(r.logicalId) ? "Moved to Trash by “Clear schedule” (also cleared from the public schedule)" : "Moved to Trash by “Clear schedule”",
            snapshot: rowToDoc(r),
            userId: actor.id,
          })),
        );
      }
    }
    if (c.phaseIds.length) await tx.update(phases).set({ deletedAt: sql`now()`, clearBatchId: batch.id }).where(inArray(phases.id, c.phaseIds));
    if (c.drillIds.length) await tx.update(drills).set({ deletedAt: sql`now()`, clearBatchId: batch.id }).where(inArray(drills.id, c.drillIds));
    if (c.templateIds.length) await tx.update(templates).set({ deletedAt: sql`now()`, clearBatchId: batch.id }).where(inArray(templates.id, c.templateIds));

    // 2) public scope (resolved independently of the track's rows) — backup first
    if (c.live.length || c.livePhases.length) {
      const b = await backupBeforeLiveChange(tx, season, c.scope, {
        includePhases: !!req.includePhases,
        reason: "before-clear",
        actor,
        slot: req.slot,
        operationId: req.operationId,
      });
      backupSlot = b.slot;
      backupSnapshotId = b.snapshot.id;
      const gen = await bumpGeneration(tx, season);
      await removeLiveBulk(tx, season, gen, c.live, { action: "clear", actor, operationId: req.operationId });
      if (c.livePhases.length) await replacePublicPhases(tx, c.scope, []);
      if (t && !t.deletedAt) await setBaselines(tx, t.id, [...clearedLive], gen);
      await logLive(tx, season, {
        action: "clear",
        actor,
        count: c.live.length,
        operationId: req.operationId,
        details: { scope: c.scope, target: req.target, batchId: batch.id, backupSlot, ...counts },
      });
      await tx.update(clearBatches).set({ backupSnapshotId }).where(eq(clearBatches.id, batch.id));
    }
    await audit(tx, actor.id, "schedule.cleared", { batchId: batch.id, target: req.target, scope: c.scope, counts, backupSlot });
    return { noop: false, batchId: batch.id as string | null, backupSlot, counts };
  });
}

// ---------------------------------------------------------------------------
// Trash listing (every age — nothing expires silently)
// ---------------------------------------------------------------------------
export async function listTrash(seasonId: string) {
  if (!isUuid(seasonId)) throw notFound("Season not found.");
  const db = getDb();
  const seasonTracks = await db.select().from(tracks).where(eq(tracks.seasonId, seasonId));
  const trackIds = seasonTracks.map((t) => t.id);
  const trackName = new Map(seasonTracks.map((t) => [t.id, t.name]));
  const none = ["00000000-0000-0000-0000-000000000000"];
  const ids = trackIds.length ? trackIds : none;
  const deletedBy = users;
  const ev = await db
    .select({ row: events, byName: deletedBy.name })
    .from(events)
    .leftJoin(deletedBy, eq(deletedBy.id, events.deletedBy))
    .where(and(inArray(events.trackId, ids), isNotNull(events.deletedAt)))
    .orderBy(desc(events.deletedAt))
    .limit(5000);
  const ph = await db.select().from(phases).where(and(inArray(phases.trackId, ids), isNotNull(phases.deletedAt))).orderBy(desc(phases.deletedAt));
  const dr = await db.select().from(drills).where(and(isNotNull(drills.deletedAt), sql`(${drills.trackId} IS NULL OR ${drills.trackId} = ANY(${sql.raw(`'{${ids.join(",")}}'`)}::uuid[]))`)).orderBy(desc(drills.deletedAt));
  const tp = await db.select().from(templates).where(and(isNotNull(templates.deletedAt), sql`(${templates.trackId} IS NULL OR ${templates.trackId} = ANY(${sql.raw(`'{${ids.join(",")}}'`)}::uuid[]))`)).orderBy(desc(templates.deletedAt));
  const batches = await db
    .select({ b: clearBatches, userName: users.name })
    .from(clearBatches)
    .leftJoin(users, eq(users.id, clearBatches.userId))
    .where(eq(clearBatches.seasonId, seasonId))
    .orderBy(desc(clearBatches.createdAt))
    .limit(200);
  const now = Date.now();
  const age = (d: string | null) => (d ? Math.floor((now - new Date(d).getTime()) / 86_400_000) : 0);
  const removedTracks = seasonTracks.filter((t) => t.deletedAt);
  const removedCounts = new Map<string, number>();
  for (const t of removedTracks) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.trackId, t.id), isNull(events.deletedAt)));
    removedCounts.set(t.id, n);
  }
  const evItems = ev.map(({ row, byName }) => {
    const doc = rowToDoc(row);
    return {
      id: row.id,
      trackId: row.trackId,
      trackName: trackName.get(row.trackId) ?? "",
      logicalId: row.logicalId,
      title: displayTitle(doc),
      kind: row.kind,
      date: row.date,
      startTime: row.startTime,
      deletedAt: row.deletedAt!,
      deletedByName: byName,
      batchId: row.clearBatchId,
      hadPublic: row.deletedPublicPayload != null,
      ageDays: age(row.deletedAt),
    };
  });
  return {
    batches: batches.map(({ b, userName }) => ({
      id: b.id,
      createdAt: b.createdAt,
      userName,
      target: b.target,
      scope: b.scope,
      counts: b.counts,
      trackId: b.trackId,
      trackName: b.trackId ? trackName.get(b.trackId) ?? "" : null,
      hasBackup: !!b.backupSnapshotId,
      remaining: {
        events: evItems.filter((e) => e.batchId === b.id).length,
        phases: ph.filter((p) => p.clearBatchId === b.id).length,
        drills: dr.filter((d) => d.clearBatchId === b.id).length,
        templates: tp.filter((d) => d.clearBatchId === b.id).length,
      },
    })),
    events: evItems,
    phases: ph.map((p) => ({ id: p.id, trackId: p.trackId, trackName: trackName.get(p.trackId) ?? "", name: p.name, startDate: p.startDate, endDate: p.endDate, deletedAt: p.deletedAt!, batchId: p.clearBatchId, ageDays: age(p.deletedAt) })),
    drills: dr.map((d) => ({ id: d.id, title: d.title, trackId: d.trackId, trackName: d.trackId ? trackName.get(d.trackId) ?? "" : null, deletedAt: d.deletedAt!, batchId: d.clearBatchId, ageDays: age(d.deletedAt) })),
    templates: tp.map((d) => ({ id: d.id, name: d.name, trackId: d.trackId, trackName: d.trackId ? trackName.get(d.trackId) ?? "" : null, deletedAt: d.deletedAt!, batchId: d.clearBatchId, ageDays: age(d.deletedAt) })),
    tracks: removedTracks.map((t) => ({ id: t.id, name: t.name, deletedAt: t.deletedAt!, events: removedCounts.get(t.id) ?? 0, ageDays: age(t.deletedAt) })),
  };
}

// ---------------------------------------------------------------------------
// Restore from Trash (atomic; collisions are reported, never overwritten)
// ---------------------------------------------------------------------------
export type RestoreResolution = "replace" | "copy" | "skip";

export interface RestoreRequest {
  seasonId: string;
  batchId?: string | null;
  events?: string[];
  phases?: string[];
  drills?: string[];
  templates?: string[];
  tracks?: string[];
  /** Explicit, labelled choice: put events that were cleared/deleted from the public schedule back on it (only where nothing is live now). */
  publicRestore?: boolean;
  resolutions?: Record<string, RestoreResolution>;
  operationId?: string | null;
}

export interface RestoreConflict {
  itemType: "event" | "drill" | "template";
  id: string;
  title: string;
  date: string | null;
  trackName: string;
  reason: "same-event" | "same-key" | "track-removed";
  activeId: string | null;
  activeTitle: string | null;
  activeDate: string | null;
  activeUpdatedAt: string | null;
}

export async function restoreFromTrash(actor: SessionUser, req: RestoreRequest) {
  if (!isUuid(req.seasonId)) throw notFound("Season not found.");
  return runOperation(req.operationId, "trash-restore", actor, req.seasonId, async (tx) => {
    const season = await lockSeason(tx, req.seasonId);
    const seasonTracks = await tx.select().from(tracks).where(eq(tracks.seasonId, season.id)).for("update");
    const trackById = new Map(seasonTracks.map((t) => [t.id, t]));
    let eventIds = [...new Set(req.events ?? [])];
    let phaseIds = [...new Set(req.phases ?? [])];
    let drillIds = [...new Set(req.drills ?? [])];
    let templateIds = [...new Set(req.templates ?? [])];
    const trackIds = [...new Set(req.tracks ?? [])];
    if (req.batchId) {
      if (!isUuid(req.batchId)) throw notFound("That clear batch no longer exists.");
      const [batch] = await tx.select().from(clearBatches).where(and(eq(clearBatches.id, req.batchId), eq(clearBatches.seasonId, season.id))).limit(1);
      if (!batch) throw notFound("That clear batch no longer exists.");
      eventIds = (await tx.select({ id: events.id }).from(events).where(and(eq(events.clearBatchId, batch.id), isNotNull(events.deletedAt)))).map((r) => r.id);
      phaseIds = (await tx.select({ id: phases.id }).from(phases).where(and(eq(phases.clearBatchId, batch.id), isNotNull(phases.deletedAt)))).map((r) => r.id);
      drillIds = (await tx.select({ id: drills.id }).from(drills).where(and(eq(drills.clearBatchId, batch.id), isNotNull(drills.deletedAt)))).map((r) => r.id);
      templateIds = (await tx.select({ id: templates.id }).from(templates).where(and(eq(templates.clearBatchId, batch.id), isNotNull(templates.deletedAt)))).map((r) => r.id);
    }
    const all = [...eventIds, ...phaseIds, ...drillIds, ...templateIds, ...trackIds];
    if (!all.every(isUuid)) throw badRequest("Invalid item id.");
    if (all.length === 0) throw badRequest("Choose something to restore.");
    if (eventIds.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `Restore at most ${MAX_BULK_ROWS} events at a time.`);
    const resolutions = req.resolutions ?? {};

    // tracks first (their rows come back with them)
    const restoredTracks: string[] = [];
    for (const id of trackIds) {
      const t = trackById.get(id);
      if (!t) throw notFound("That track is not in this season.");
      if (!t.deletedAt) continue;
      const active = seasonTracks.filter((x) => !x.deletedAt || restoredTracks.includes(x.id));
      let name = t.name;
      let n = 2;
      while (active.some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())) name = `${t.name} (restored${n > 2 ? ` ${n - 1}` : ""})`, n++;
      await tx.update(tracks).set({ deletedAt: null, deletedBy: null, name, updatedAt: sql`now()` }).where(eq(tracks.id, id));
      t.deletedAt = null;
      t.name = name;
      restoredTracks.push(id);
    }

    const rows = eventIds.length ? await tx.select().from(events).where(inArray(events.id, eventIds)).orderBy(asc(events.deletedAt)).for("update") : [];
    if (rows.length !== eventIds.length) throw notFound("Some items are no longer in Trash (they may have been restored or permanently deleted). Refresh and try again.");
    const conflicts: RestoreConflict[] = [];
    const plan: Array<{ row: EventRow; mode: "restore" | "copy"; replaceId: string | null }> = [];
    const claimed = new Map<string, string>(); // `${track}|logical` or `${track}#key` -> row id being restored
    for (const row of rows) {
      if (!row.deletedAt) continue;
      const t = trackById.get(row.trackId);
      const title = displayTitle(rowToDoc(row));
      if (!t) throw notFound("That item is not in this season.");
      if (t.deletedAt) {
        conflicts.push({ itemType: "event", id: row.id, title, date: row.date, trackName: t.name, reason: "track-removed", activeId: null, activeTitle: null, activeDate: null, activeUpdatedAt: null });
        continue;
      }
      const res = resolutions[row.id];
      if (res === "skip") continue;
      const [sameEvent] = await tx
        .select()
        .from(events)
        .where(and(eq(events.trackId, row.trackId), eq(events.logicalId, row.logicalId), isNull(events.deletedAt)))
        .limit(1);
      const [sameKey] = row.externalRef
        ? await tx
            .select()
            .from(events)
            .where(and(eq(events.trackId, row.trackId), eq(events.externalRef, row.externalRef), isNull(events.deletedAt)))
            .limit(1)
        : [];
      const claimedBy = claimed.get(`${row.trackId}|${row.logicalId}`) ?? (row.externalRef ? claimed.get(`${row.trackId}#${row.externalRef}`) : undefined);
      const active = sameEvent ?? sameKey ?? null;
      if (active || claimedBy) {
        if (res === "copy") {
          plan.push({ row, mode: "copy", replaceId: null });
          continue;
        }
        if (res === "replace" && active && !claimedBy) {
          plan.push({ row, mode: "restore", replaceId: active.id });
          claimed.set(`${row.trackId}|${row.logicalId}`, row.id);
          if (row.externalRef) claimed.set(`${row.trackId}#${row.externalRef}`, row.id);
          continue;
        }
        const other = active ? rowToDoc(active) : null;
        conflicts.push({
          itemType: "event",
          id: row.id,
          title,
          date: row.date,
          trackName: t.name,
          reason: sameEvent || (claimedBy && claimed.get(`${row.trackId}|${row.logicalId}`)) ? "same-event" : "same-key",
          activeId: active?.id ?? claimedBy ?? null,
          activeTitle: other ? displayTitle(other) : "another item restored in this same request",
          activeDate: active?.date ?? null,
          activeUpdatedAt: active?.updatedAt ?? null,
        });
        continue;
      }
      plan.push({ row, mode: "restore", replaceId: null });
      claimed.set(`${row.trackId}|${row.logicalId}`, row.id);
      if (row.externalRef) claimed.set(`${row.trackId}#${row.externalRef}`, row.id);
    }

    // library items: collisions on the scoped import key
    const libPlan: Array<{ table: "drill" | "template"; id: string; copy: boolean; replaceId: string | null }> = [];
    for (const [kind, ids] of [["drill", drillIds], ["template", templateIds]] as const) {
      if (!ids.length) continue;
      const table = kind === "drill" ? drills : templates;
      const list = await tx.select().from(table).where(inArray(table.id, ids)).for("update");
      if (list.length !== ids.length) throw notFound("Some items are no longer in Trash. Refresh and try again.");
      for (const item of list) {
        if (!item.deletedAt) continue;
        const res = resolutions[item.id];
        if (res === "skip") continue;
        const label = "title" in item ? item.title : item.name;
        if (item.trackId && trackById.get(item.trackId)?.deletedAt) {
          conflicts.push({ itemType: kind, id: item.id, title: label, date: null, trackName: trackById.get(item.trackId)!.name, reason: "track-removed", activeId: null, activeTitle: null, activeDate: null, activeUpdatedAt: null });
          continue;
        }
        if (!item.externalRef) {
          libPlan.push({ table: kind, id: item.id, copy: false, replaceId: null });
          continue;
        }
        const [active] = await tx
          .select()
          .from(table)
          .where(and(eq(table.externalRef, item.externalRef), isNull(table.deletedAt), item.trackId ? eq(table.trackId, item.trackId) : isNull(table.trackId)))
          .limit(1);
        if (!active) libPlan.push({ table: kind, id: item.id, copy: false, replaceId: null });
        else if (res === "copy") libPlan.push({ table: kind, id: item.id, copy: true, replaceId: null });
        else if (res === "replace") libPlan.push({ table: kind, id: item.id, copy: false, replaceId: active.id });
        else
          conflicts.push({
            itemType: kind,
            id: item.id,
            title: label,
            date: null,
            trackName: item.trackId ? trackById.get(item.trackId)?.name ?? "" : "Shared library",
            reason: "same-key",
            activeId: active.id,
            activeTitle: "title" in active ? active.title : active.name,
            activeDate: null,
            activeUpdatedAt: active.updatedAt,
          });
      }
    }
    if (conflicts.length) {
      throw new AppError(
        409,
        "restore_conflict",
        `${conflicts.length} item${conflicts.length === 1 ? "" : "s"} can't be restored without a decision: a newer active item has the same identity or import key. Nothing was restored.`,
        { conflicts },
      );
    }

    // --- apply (all or nothing: we are still inside one transaction)
    let published = 0;
    const alreadyLive: string[] = [];
    const toPublish: Array<{ row: EventRow; payload: PublicEvent }> = [];
    for (const p of plan) {
      if (p.replaceId) {
        const [old] = await tx.select().from(events).where(eq(events.id, p.replaceId)).for("update").limit(1);
        await tx.update(events).set({ deletedAt: sql`now()`, deletedBy: actor.id, version: old.version + 1 }).where(eq(events.id, old.id));
        await recordRevision(tx, { eventId: old.id, version: old.version + 1, action: "delete", summary: "Moved to Trash (replaced by a restored version)", snapshot: rowToDoc(old), userId: actor.id });
      }
      let logicalId = p.row.logicalId;
      let externalRef = p.row.externalRef;
      if (p.mode === "copy") {
        const [le] = await tx.insert(logicalEvents).values({ seasonId: season.id }).returning({ id: logicalEvents.id });
        logicalId = le.id;
        externalRef = null;
      }
      const version = p.row.version + 1; // never rewinds
      await tx
        .update(events)
        .set({ deletedAt: null, deletedBy: null, clearBatchId: null, deletedPublicPayload: null, version, logicalId, externalRef, updatedAt: sql`now()`, updatedBy: actor.id })
        .where(eq(events.id, p.row.id));
      await recordRevision(tx, {
        eventId: p.row.id,
        version,
        action: "restore",
        summary: p.mode === "copy" ? "Restored from Trash as a separate copy" : "Restored from Trash",
        snapshot: rowToDoc(p.row),
        userId: actor.id,
      });
      if (req.publicRestore && p.mode === "restore" && p.row.deletedPublicPayload) toPublish.push({ row: p.row, payload: p.row.deletedPublicPayload });
    }
    if (toPublish.length) {
      const liveNow = await tx.select({ id: publicEvents.logicalId }).from(publicEvents).where(inArray(publicEvents.logicalId, toPublish.map((x) => x.row.logicalId)));
      const liveSet = new Set(liveNow.map((r) => r.id));
      const go = toPublish.filter((x) => {
        if (liveSet.has(x.row.logicalId)) {
          alreadyLive.push(x.row.id);
          return false;
        }
        return true;
      });
      if (go.length) {
        const gen = await bumpGeneration(tx, season);
        for (const x of go) {
          await writeLive(
            tx,
            season,
            gen,
            { logicalId: x.row.logicalId, payload: { ...x.payload, publishedAt: new Date().toISOString(), notice: null }, sourceRowId: x.row.id, sourceTrackId: x.row.trackId, sourceVersion: x.row.version + 1, locationId: x.row.locationId },
            { action: "trash-restore", actor, operationId: req.operationId },
          );
          await setBaselines(tx, x.row.trackId, [x.row.logicalId], gen);
          published++;
        }
        await logLive(tx, season, { action: "trash-restore", actor, count: published, operationId: req.operationId, details: { batchId: req.batchId ?? null, published } });
      }
    }
    if (phaseIds.length) {
      const ph = await tx.select().from(phases).where(inArray(phases.id, phaseIds));
      for (const p of ph) if (trackById.get(p.trackId)?.deletedAt) throw new AppError(409, "track_removed", `Restore the track “${trackById.get(p.trackId)!.name}” first.`);
      await tx.update(phases).set({ deletedAt: null, clearBatchId: null, updatedAt: sql`now()` }).where(inArray(phases.id, phaseIds));
    }
    for (const l of libPlan) {
      const table = l.table === "drill" ? drills : templates;
      if (l.replaceId) await tx.update(table).set({ deletedAt: sql`now()` }).where(eq(table.id, l.replaceId));
      await tx
        .update(table)
        .set({ deletedAt: null, clearBatchId: null, updatedAt: sql`now()`, ...(l.copy ? { externalRef: null } : {}) })
        .where(eq(table.id, l.id));
    }
    const report = {
      restored: { events: plan.length, phases: phaseIds.length, drills: libPlan.filter((l) => l.table === "drill").length, templates: libPlan.filter((l) => l.table === "template").length, tracks: restoredTracks.length },
      copies: plan.filter((p) => p.mode === "copy").length,
      replaced: plan.filter((p) => p.replaceId).length,
      published,
      alreadyLive: alreadyLive.length,
    };
    await audit(tx, actor.id, "trash.restored", { seasonId: season.id, batchId: req.batchId ?? null, publicRestore: !!req.publicRestore, ...report.restored, published });
    return report;
  });
}

/** Single-event restore (keeps the old "restore its public version" behavior when asked — labelled in the UI). */
export async function undeleteEvent(actor: SessionUser, id: string, opts: { republish?: boolean; resolution?: RestoreResolution; operationId?: string | null } = {}) {
  if (!isUuid(id)) throw notFound("Event not found.");
  const [row] = await getDb().select({ trackId: events.trackId }).from(events).where(eq(events.id, id)).limit(1);
  if (!row) throw notFound("Event not found.");
  const t = await getTrack(row.trackId);
  return restoreFromTrash(actor, {
    seasonId: t!.seasonId,
    events: [id],
    publicRestore: !!opts.republish,
    resolutions: opts.resolution ? { [id]: opts.resolution } : undefined,
    operationId: opts.operationId,
  });
}

// ---------------------------------------------------------------------------
// Permanent purge (administrators only)
// ---------------------------------------------------------------------------
export interface PurgeRequest {
  /** "season" (optionally one track) or "all" (whole app, clearly labelled). */
  scope: "items" | "batch" | "season" | "all";
  seasonId?: string | null;
  trackId?: string | null;
  batchId?: string | null;
  events?: string[];
  phases?: string[];
  drills?: string[];
  templates?: string[];
  tracks?: string[];
}

async function purgeTargets(db: DbOrTx, req: PurgeRequest) {
  const out = { events: [] as string[], phases: [] as string[], drills: [] as string[], templates: [] as string[], tracks: [] as string[], trackEvents: 0, batches: [] as string[] };
  const idsIn = async (table: typeof events | typeof phases | typeof drills | typeof templates, ids: string[] | undefined) => {
    const list = [...new Set(ids ?? [])];
    if (!list.every(isUuid)) throw badRequest("Invalid item id.");
    if (!list.length) return [];
    return (await db.select({ id: table.id }).from(table).where(and(inArray(table.id, list), isNotNull(table.deletedAt)))).map((r) => r.id);
  };
  if (req.scope === "items") {
    out.events = await idsIn(events, req.events);
    out.phases = await idsIn(phases, req.phases);
    out.drills = await idsIn(drills, req.drills);
    out.templates = await idsIn(templates, req.templates);
    const tl = [...new Set(req.tracks ?? [])].filter(isUuid);
    if (tl.length) out.tracks = (await db.select({ id: tracks.id }).from(tracks).where(and(inArray(tracks.id, tl), isNotNull(tracks.deletedAt)))).map((r) => r.id);
  } else if (req.scope === "batch") {
    if (!req.batchId || !isUuid(req.batchId)) throw badRequest("Choose a batch.");
    out.events = (await db.select({ id: events.id }).from(events).where(and(eq(events.clearBatchId, req.batchId), isNotNull(events.deletedAt)))).map((r) => r.id);
    out.phases = (await db.select({ id: phases.id }).from(phases).where(and(eq(phases.clearBatchId, req.batchId), isNotNull(phases.deletedAt)))).map((r) => r.id);
    out.drills = (await db.select({ id: drills.id }).from(drills).where(and(eq(drills.clearBatchId, req.batchId), isNotNull(drills.deletedAt)))).map((r) => r.id);
    out.templates = (await db.select({ id: templates.id }).from(templates).where(and(eq(templates.clearBatchId, req.batchId), isNotNull(templates.deletedAt)))).map((r) => r.id);
    out.batches = [req.batchId];
  } else {
    let trackList: Array<{ id: string; deletedAt: string | null }>;
    if (req.scope === "season") {
      if (!req.seasonId || !isUuid(req.seasonId)) throw badRequest("Choose a season.");
      trackList = await db.select({ id: tracks.id, deletedAt: tracks.deletedAt }).from(tracks).where(eq(tracks.seasonId, req.seasonId));
      if (req.trackId) trackList = trackList.filter((t) => t.id === req.trackId);
      if (!req.trackId) out.batches = (await db.select({ id: clearBatches.id }).from(clearBatches).where(eq(clearBatches.seasonId, req.seasonId))).map((r) => r.id);
      else out.batches = (await db.select({ id: clearBatches.id }).from(clearBatches).where(eq(clearBatches.trackId, req.trackId))).map((r) => r.id);
    } else {
      trackList = await db.select({ id: tracks.id, deletedAt: tracks.deletedAt }).from(tracks);
      out.batches = (await db.select({ id: clearBatches.id }).from(clearBatches)).map((r) => r.id);
    }
    const ids = trackList.map((t) => t.id);
    if (ids.length) {
      out.events = (await db.select({ id: events.id }).from(events).where(and(inArray(events.trackId, ids), isNotNull(events.deletedAt)))).map((r) => r.id);
      out.phases = (await db.select({ id: phases.id }).from(phases).where(and(inArray(phases.trackId, ids), isNotNull(phases.deletedAt)))).map((r) => r.id);
      out.drills = (await db.select({ id: drills.id }).from(drills).where(and(inArray(drills.trackId, ids), isNotNull(drills.deletedAt)))).map((r) => r.id);
      out.templates = (await db.select({ id: templates.id }).from(templates).where(and(inArray(templates.trackId, ids), isNotNull(templates.deletedAt)))).map((r) => r.id);
    }
    out.tracks = trackList.filter((t) => t.deletedAt).map((t) => t.id);
    if (req.scope === "all") {
      out.drills.push(...(await db.select({ id: drills.id }).from(drills).where(and(isNull(drills.trackId), isNotNull(drills.deletedAt)))).map((r) => r.id));
      out.templates.push(...(await db.select({ id: templates.id }).from(templates).where(and(isNull(templates.trackId), isNotNull(templates.deletedAt)))).map((r) => r.id));
    }
  }
  if (out.tracks.length) {
    out.trackEvents = (await db.select({ n: sql<number>`count(*)::int` }).from(events).where(and(inArray(events.trackId, out.tracks), isNull(events.deletedAt))))[0].n;
  }
  const total = out.events.length + out.phases.length + out.drills.length + out.templates.length + out.tracks.length + out.trackEvents;
  return { ...out, total };
}

export async function previewPurge(actor: SessionUser, req: PurgeRequest) {
  if (actor.role !== "admin") throw forbidden("Only administrators can permanently delete items from Trash.");
  const t = await purgeTargets(getDb(), req);
  return { total: t.total, events: t.events.length, phases: t.phases.length, drills: t.drills.length, templates: t.templates.length, tracks: t.tracks.length, eventsInRemovedTracks: t.trackEvents };
}

/** Permanently deletes. Saved public backups are NOT touched (they may still contain previously published content). */
export async function purgeTrash(actor: SessionUser, req: PurgeRequest & { expectedCount: number }) {
  if (actor.role !== "admin") throw forbidden("Only administrators can permanently delete items from Trash.");
  return getDb().transaction(async (tx) => {
    if (req.seasonId && isUuid(req.seasonId)) await lockSeason(tx, req.seasonId);
    const t = await purgeTargets(tx, req);
    if (t.total !== req.expectedCount) {
      throw new AppError(409, "count_changed", `Trash changed since you reviewed it (now ${t.total} item${t.total === 1 ? "" : "s"}). Review again before deleting permanently.`, { total: t.total });
    }
    for (let i = 0; i < t.events.length; i += 1000) await tx.delete(events).where(inArray(events.id, t.events.slice(i, i + 1000)));
    if (t.phases.length) await tx.delete(phases).where(inArray(phases.id, t.phases));
    if (t.drills.length) await tx.delete(drills).where(inArray(drills.id, t.drills));
    if (t.templates.length) await tx.delete(templates).where(inArray(templates.id, t.templates));
    if (t.tracks.length) await tx.delete(tracks).where(inArray(tracks.id, t.tracks));
    // batch records whose items are all gone
    const batchIds = new Set(t.batches);
    if (req.scope === "items") {
      const touched = await tx.execute<{ id: string }>(sql`
        SELECT b.id FROM clear_batches b
        WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.clear_batch_id = b.id AND e.deleted_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM phases p WHERE p.clear_batch_id = b.id AND p.deleted_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM drills d WHERE d.clear_batch_id = b.id AND d.deleted_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM templates t WHERE t.clear_batch_id = b.id AND t.deleted_at IS NOT NULL)
          AND (b.counts->>'events')::int + (b.counts->>'phases')::int + (b.counts->>'drills')::int + (b.counts->>'templates')::int > 0`);
      for (const r of touched.rows) batchIds.add(r.id);
    }
    if (batchIds.size) await tx.delete(clearBatches).where(inArray(clearBatches.id, [...batchIds]));
    // snapshots that only a deleted batch referenced (never one that is in a backup slot)
    await tx.execute(sql`
      DELETE FROM backup_snapshots s
      WHERE NOT EXISTS (SELECT 1 FROM backup_slots b WHERE b.snapshot_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM clear_batches c WHERE c.backup_snapshot_id = s.id)`);
    await audit(tx, actor.id, "trash.purged", { scope: req.scope, seasonId: req.seasonId ?? null, trackId: req.trackId ?? null, total: t.total });
    return { purged: t.total };
  });
}
