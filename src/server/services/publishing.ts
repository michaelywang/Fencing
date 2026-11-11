import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { eventPublications, events, logicalEvents, phases, trackBaselines, tracks, users } from "@/server/db/schema";
import { AppError, ConflictError, badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import type { EventDoc } from "@/lib/schemas";
import type { PublicEvent, PublicNotice } from "@/lib/projection";
import type { EventKind } from "@/lib/constants";
import { displayTitle } from "@/lib/practice";
import { formatClock, formatClockRange, formatDateMedium, isClockTime, isISODate, todayInTimeZone } from "@/lib/dates";
import { LOGISTICS_FIELDS, logisticsOf, publicToDoc, type LogisticsField, type LogisticsValues } from "@/lib/fromPublic";
import { phaseOverlapsScope, scopeIncludes, type BackupPhase, type LiveScope } from "@/lib/liveTypes";
import type { EventRecord } from "@/lib/view";
import { canonicalJson, publicContentHash, sha256 } from "@/server/live/hash";
import { loadProjectionCtx, projectDoc, type ProjectionCtx } from "@/server/live/project";
import {
  bumpGeneration,
  liveRow,
  liveRowsForSeason,
  lockSeason,
  logLive,
  phaseKey,
  publicPhasesInScope,
  replacePublicPhases,
  writeLive,
  type LiveRow,
  type SeasonRow,
} from "@/server/live/store";
import {
  conflictFor,
  createEventTx,
  getEvent,
  lockRow,
  recordRevision,
  rowToDoc,
  saveEventTx,
  setBaselines,
  type EventRow,
} from "./events";
import { getLocation, getSettings } from "./settings";
import { MAX_BULK_ROWS, getSeason, getTrack, lockTrack, parseScope, type ScopeInput, type TrackRow } from "./scope";
import { backupBeforeLiveChange, slotPlan, type SlotInfo } from "./backups";
import { runOperation } from "./operations";
import { isUuid } from "./ids";

// ---------------------------------------------------------------------------
// Review model (shared by "publish selected" and "replace scope")
// ---------------------------------------------------------------------------
export type ConflictType = "live-changed" | "live-added" | "live-removed";
export type Resolution = "overwrite" | "skip" | "take-live";
export type ChangeTag = "date" | "time" | "location" | "canceled" | "reinstated" | "confirmation" | "title" | "plan" | "logistics" | "details";

export interface EventBrief {
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  kind: string;
  status: string;
  location: string;
}

export interface ReviewItem {
  logicalId: string;
  rowId: string | null;
  rowVersion: number | null;
  title: string;
  kind: EventKind;
  action: "add" | "update" | "remove" | "unchanged";
  before: EventBrief | null;
  after: EventBrief | null;
  changes: ChangeTag[];
  /** The event moves across the scope boundary (old published date and proposed date on different sides). */
  crossesScope: "into" | "out" | null;
  conflict: { type: ConflictType; liveGeneration: number; baseline: number } | null;
  past: boolean;
  hasCompletedNotes: boolean;
}

export interface ReviewCounts {
  add: number;
  update: number;
  remove: number;
  unchanged: number;
  cancellations: number;
  reinstatements: number;
  dateTimeChanges: number;
  locationChanges: number;
  planChanges: number;
  conflicts: number;
  past: number;
  completedNotes: number;
  crossings: number;
  /** Live events of this season left untouched because they are outside the scope / selection. */
  outOfScopePreserved: number;
}

export interface PhaseReview {
  add: BackupPhase[];
  remove: BackupPhase[];
  unchanged: number;
}

export interface BackupPlan {
  /** A backup of the live scope is taken before this operation. */
  required: boolean;
  slots: Array<Pick<SlotInfo, "slot" | "label" | "createdAt" | "eventCount" | "dateFrom" | "dateTo" | "reason"> | null>;
  firstEmpty: number | null;
}

export interface Review {
  mode: "selected" | "replace";
  seasonId: string;
  seasonName: string;
  trackId: string;
  trackName: string;
  scope: LiveScope | null;
  items: ReviewItem[];
  counts: ReviewCounts;
  phases: PhaseReview | null;
  backup: BackupPlan | null;
  liveGeneration: number;
  today: string;
  token: string;
}

const brief = (p: PublicEvent): EventBrief => ({
  date: p.date,
  startTime: p.startTime,
  endTime: p.endTime,
  title: displayTitle(p),
  kind: p.kind,
  status: p.status,
  location: p.location ? p.location.name : p.locationNote,
});

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export function diffTags(before: PublicEvent, after: PublicEvent): ChangeTag[] {
  const tags: ChangeTag[] = [];
  if (before.date !== after.date) tags.push("date");
  if (before.startTime !== after.startTime || before.endTime !== after.endTime) tags.push("time");
  if (!same(before.location, after.location) || before.locationNote !== after.locationNote) tags.push("location");
  if (before.status !== after.status) tags.push(after.status === "canceled" ? "canceled" : "reinstated");
  else if (before.cancelReason !== after.cancelReason) tags.push("details");
  if (before.confirmation !== after.confirmation) tags.push("confirmation");
  if (before.title !== after.title || before.kind !== after.kind) tags.push("title");
  const plan = (p: PublicEvent) => [p.blocks, p.objectives, p.theme, p.intensity, p.targetMinutes, p.weaponSummaries, p.equipment, p.levelNotes];
  if (!same(plan(before), plan(after))) tags.push("plan");
  if (!same(before.meet, after.meet)) tags.push("logistics");
  const rest = (p: PublicEvent) => [p.announcement, p.links, p.coachAssignments, p.timezone];
  if (!same(rest(before), rest(after)) && !tags.includes("details")) tags.push("details");
  return tags;
}

/** Logistics fields a public change notice describes; the notice is kept only while they are unchanged. */
const logisticsKey = (p: PublicEvent) =>
  canonicalJson([p.date, p.startTime, p.endTime, p.location?.name ?? null, p.locationNote, p.meet?.reportTime ?? null, p.meet?.busDepart ?? null, p.meet?.busReturn ?? null]);

export function carryNotice(prev: PublicEvent | null, next: PublicEvent): PublicNotice | null {
  if (!prev?.notice) return null;
  return logisticsKey(prev) === logisticsKey(next) ? prev.notice : null;
}

interface LoadedRow {
  row: EventRow;
  doc: EventDoc;
  projected: PublicEvent;
}

interface ReviewContext {
  review: Review;
  rows: Map<string, LoadedRow>; // by row id
  live: Map<string, LiveRow>; // by logical id
  gens: Map<string, number>;
  baselines: Map<string, number>;
  trackPhases: BackupPhase[] | null;
  ctx: ProjectionCtx;
}

async function loadBaselines(db: DbOrTx, trackId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db
      .select({ id: trackBaselines.logicalId, gen: trackBaselines.seenGeneration })
      .from(trackBaselines)
      .where(and(eq(trackBaselines.trackId, trackId), inArray(trackBaselines.logicalId, ids.slice(i, i + 1000))));
    for (const r of rows) out.set(r.id, r.gen);
  }
  return out;
}

async function loadGenerations(db: DbOrTx, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db
      .select({ id: logicalEvents.id, gen: logicalEvents.liveGeneration })
      .from(logicalEvents)
      .where(inArray(logicalEvents.id, ids.slice(i, i + 1000)));
    for (const r of rows) out.set(r.id, r.gen);
  }
  return out;
}

export interface ReviewRequest {
  mode: "selected" | "replace";
  rowIds?: string[];
  removeLogicalIds?: string[];
  scope?: ScopeInput | null;
  includePhases?: boolean;
}

async function computeReview(db: DbOrTx, season: SeasonRow, track: TrackRow, req: ReviewRequest, lock: boolean): Promise<ReviewContext> {
  const settings = await getSettings(db);
  const today = todayInTimeZone(settings.timezone);
  const ctx = await loadProjectionCtx(db);
  const scope = req.mode === "replace" ? parseScope(season.id, req.scope) : null;

  // --- rows of the track that take part
  let rowList: EventRow[];
  if (req.mode === "selected") {
    const ids = [...new Set(req.rowIds ?? [])];
    if (!ids.every(isUuid)) throw badRequest("Invalid event id.");
    if (ids.length + (req.removeLogicalIds?.length ?? 0) === 0) throw badRequest("Choose at least one change to publish.");
    if (ids.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `Publish at most ${MAX_BULK_ROWS} events at a time.`);
    let q = db.select().from(events).where(and(inArray(events.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]), isNull(events.deletedAt))).orderBy(asc(events.id)).$dynamic();
    if (lock) q = q.for("update");
    rowList = ids.length ? await q : [];
    if (rowList.length !== ids.length) throw notFound("Some events no longer exist (they may have been deleted or cleared). Refresh and try again.");
    if (rowList.some((r) => r.trackId !== track.id)) throw badRequest("Every selected event must belong to the selected track.");
  } else {
    let q = db.select().from(events).where(and(eq(events.trackId, track.id), isNull(events.deletedAt))).orderBy(asc(events.id)).$dynamic();
    if (lock) q = q.for("update");
    rowList = await q;
    if (rowList.length > MAX_BULK_ROWS) throw new AppError(413, "too_large", `This track has more than ${MAX_BULK_ROWS} events; narrow the scope by date.`);
  }
  const rows = new Map<string, LoadedRow>();
  const rowByLogical = new Map<string, LoadedRow>();
  for (const row of rowList) {
    const doc = rowToDoc(row);
    const loaded = { row, doc, projected: projectDoc(ctx, { logicalId: row.logicalId, timezone: row.timezone, doc, publishedAt: "" }) };
    rows.set(row.id, loaded);
    rowByLogical.set(row.logicalId, loaded);
  }

  // --- live rows of the season (public scope is resolved independently of the track's rows)
  const liveList = await liveRowsForSeason(db, season.id);
  const live = new Map(liveList.map((l) => [l.logicalId, l]));

  // --- pairs (logical ids) under review
  const pairs = new Set<string>();
  const removeSet = new Set<string>();
  if (req.mode === "selected") {
    for (const r of rowList) pairs.add(r.logicalId);
    for (const id of req.removeLogicalIds ?? []) {
      if (!isUuid(id)) throw badRequest("Invalid event id.");
      if (live.has(id)) {
        pairs.add(id);
        removeSet.add(id);
      }
    }
  } else {
    for (const r of rows.values()) if (scopeIncludes(scope!, r.projected)) pairs.add(r.row.logicalId);
    for (const l of liveList) if (scopeIncludes(scope!, { date: l.date, kind: l.kind })) pairs.add(l.logicalId);
  }
  const ids = [...pairs];
  const gens = await loadGenerations(db, ids);
  const baselines = await loadBaselines(db, track.id, ids);

  const items: ReviewItem[] = [];
  for (const logicalId of ids.sort()) {
    const r = removeSet.has(logicalId) ? undefined : rowByLogical.get(logicalId);
    const l = live.get(logicalId);
    const g = gens.get(logicalId) ?? 0;
    const b = baselines.get(logicalId) ?? track.baselineGeneration;
    const before = l?.payload ?? null;
    const after = r?.projected ?? null;
    let action: ReviewItem["action"];
    if (after && before) action = publicContentHash(after) === publicContentHash(before) ? "unchanged" : "update";
    else if (after) action = "add";
    else if (before) action = "remove";
    else action = "unchanged";
    let conflict: ReviewItem["conflict"] = null;
    if (action !== "unchanged" && g > b) {
      const type: ConflictType = action === "update" ? "live-changed" : action === "remove" ? (rowByLogical.has(logicalId) ? "live-changed" : "live-added") : "live-removed";
      conflict = { type, liveGeneration: g, baseline: b };
    }
    let crossesScope: ReviewItem["crossesScope"] = null;
    if (scope && before && after) {
      const inBefore = scopeIncludes(scope, before);
      const inAfter = scopeIncludes(scope, after);
      if (inBefore && !inAfter) crossesScope = "out";
      if (!inBefore && inAfter) crossesScope = "into";
    }
    const ref = after ?? before!;
    items.push({
      logicalId,
      rowId: r?.row.id ?? null,
      rowVersion: r?.row.version ?? null,
      title: displayTitle(ref),
      kind: ref.kind,
      action,
      before: before ? brief(before) : null,
      after: after ? brief(after) : null,
      changes: before && after && action === "update" ? diffTags(before, after) : [],
      crossesScope,
      conflict,
      past: (after ? after.date < today : false) || (before ? before.date < today : false),
      hasCompletedNotes: !!r?.doc.completedNotes.trim(),
    });
  }

  // --- phases (replacement only, when included)
  let phaseReview: PhaseReview | null = null;
  let trackPhases: BackupPhase[] | null = null;
  if (req.mode === "replace" && req.includePhases) {
    const tp = await db
      .select()
      .from(phases)
      .where(and(eq(phases.trackId, track.id), isNull(phases.deletedAt)))
      .orderBy(asc(phases.startDate));
    trackPhases = tp
      .filter((p) => phaseOverlapsScope(scope!, p))
      .map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color }));
    const pub = (await publicPhasesInScope(db, scope!)).map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color }));
    const pubKeys = new Set(pub.map(phaseKey));
    const trackKeys = new Set(trackPhases.map(phaseKey));
    phaseReview = {
      add: trackPhases.filter((p) => !pubKeys.has(phaseKey(p))),
      remove: pub.filter((p) => !trackKeys.has(phaseKey(p))),
      unchanged: trackPhases.filter((p) => pubKeys.has(phaseKey(p))).length,
    };
  }

  const changed = items.filter((i) => i.action !== "unchanged");
  const counts: ReviewCounts = {
    add: changed.filter((i) => i.action === "add").length,
    update: changed.filter((i) => i.action === "update").length,
    remove: changed.filter((i) => i.action === "remove").length,
    unchanged: items.length - changed.length,
    cancellations: changed.filter((i) => i.changes.includes("canceled") || (i.action === "add" && i.after?.status === "canceled")).length,
    reinstatements: changed.filter((i) => i.changes.includes("reinstated")).length,
    dateTimeChanges: changed.filter((i) => i.changes.includes("date") || i.changes.includes("time")).length,
    locationChanges: changed.filter((i) => i.changes.includes("location")).length,
    planChanges: changed.filter((i) => i.changes.includes("plan")).length,
    conflicts: changed.filter((i) => i.conflict).length,
    past: changed.filter((i) => i.past).length,
    completedNotes: changed.filter((i) => i.hasCompletedNotes).length,
    crossings: changed.filter((i) => i.crossesScope).length,
    outOfScopePreserved: liveList.filter((l) => !pairs.has(l.logicalId)).length,
  };

  let backup: BackupPlan | null = null;
  if (req.mode === "replace") {
    const plan = await slotPlan(db, season.id);
    backup = {
      required: changed.length > 0 || !!(phaseReview && (phaseReview.add.length || phaseReview.remove.length)),
      slots: plan.slots.map((s) => (s ? { slot: s.slot, label: s.label, createdAt: s.createdAt, eventCount: s.eventCount, dateFrom: s.dateFrom, dateTo: s.dateTo, reason: s.reason } : null)),
      firstEmpty: plan.firstEmpty,
    };
  }

  const token = sha256(
    canonicalJson({
      mode: req.mode,
      scope,
      remove: [...removeSet].sort(),
      pairs: items.map((i) => [i.logicalId, i.rowId, i.rowVersion, gens.get(i.logicalId) ?? 0, live.get(i.logicalId) ? publicContentHash(live.get(i.logicalId)!.payload) : null]),
      phases: trackPhases ? { t: trackPhases.map(phaseKey).sort(), p: [...(phaseReview?.remove ?? []).map(phaseKey)].sort() } : null,
    }),
  );

  return {
    review: {
      mode: req.mode,
      seasonId: season.id,
      seasonName: season.name,
      trackId: track.id,
      trackName: track.name,
      scope,
      items: items.filter((i) => i.action !== "unchanged"),
      counts,
      phases: phaseReview,
      backup,
      liveGeneration: season.liveGeneration,
      today,
      token,
    },
    rows,
    live,
    gens,
    baselines,
    trackPhases,
    ctx,
  };
}

async function seasonAndTrack(db: DbOrTx, trackId: string) {
  const track = await getTrack(trackId, db);
  if (!track) throw notFound("That planning track no longer exists.");
  if (track.deletedAt) throw new AppError(409, "track_removed", `“${track.name}” was removed. Restore it from Trash to publish from it.`);
  return track;
}

/** Read-only review (no locks, no changes). */
export async function reviewPublication(trackId: string, req: ReviewRequest): Promise<Review> {
  const db = getDb();
  const track = await seasonAndTrack(db, trackId);
  const season = await getSeason(track.seasonId, db);
  if (!season) throw notFound("Season not found.");
  return (await computeReview(db, season, track, req, false)).review;
}

// ---------------------------------------------------------------------------
// Execute a publication
// ---------------------------------------------------------------------------
export interface PublishInput extends ReviewRequest {
  trackId: string;
  /** Review token from the review the coach saw (required for replacements). */
  token?: string | null;
  resolutions?: Record<string, Resolution>;
  expectedVersions?: Record<string, number>;
  note?: string;
  slot?: number | null;
  operationId?: string | null;
}

export interface PublishResult {
  noop: boolean;
  published: number;
  removed: number;
  skipped: number;
  tookLive: number;
  phasesChanged: boolean;
  generation: number;
  backupSlot: number | null;
}

/** Make a track's working copy match live for one logical event, keeping the track's private notes. */
async function adoptLive(tx: Tx, actor: SessionUser | null, track: TrackRow, logicalId: string, live: LiveRow | null, row: EventRow | null, summary: string) {
  if (!live) {
    if (row) {
      await tx
        .update(events)
        .set({ deletedAt: sql`now()`, deletedBy: actor?.id ?? null, version: row.version + 1 })
        .where(eq(events.id, row.id));
      await recordRevision(tx, { eventId: row.id, version: row.version + 1, action: "take-live", summary: `${summary} (it is no longer published, so it was moved to Trash)`, snapshot: rowToDoc(row), userId: actor?.id ?? null });
    }
    return;
  }
  const locationId = live.locationId && (await getLocation(live.locationId, tx)) ? live.locationId : null;
  if (row) {
    const cur = rowToDoc(row);
    const doc = publicToDoc(live.payload, { locationId, carry: cur });
    const { row: updated } = await saveEventTx(tx, actor, row.id, row.version, doc, { action: "take-live", summary });
    await tx.update(events).set({ publishedVersion: updated.version, publishedAt: live.payload.publishedAt }).where(eq(events.id, row.id));
  } else {
    const doc = publicToDoc(live.payload, { locationId });
    await createEventTx(tx, actor, doc, { trackId: track.id, logicalId, action: "from-published", summary: "Copied from the published schedule" });
  }
}

async function publishInTx(tx: Tx, actor: SessionUser, season: SeasonRow, track: TrackRow, input: PublishInput): Promise<PublishResult> {
  const rc = await computeReview(tx, season, track, input, true);
  const { review } = rc;
  if (input.mode === "replace" && !input.token) throw badRequest("Review the replacement before publishing it.");
  if (input.token && input.token !== review.token) {
    throw new AppError(409, "review_stale", "The schedule or this track changed since you reviewed it. Review the updated summary and try again.", { review });
  }
  for (const [rowId, expected] of Object.entries(input.expectedVersions ?? {})) {
    const r = rc.rows.get(rowId);
    if (r && r.row.version !== expected) throw await conflictFor(tx, r.row);
  }
  const resolutions = input.resolutions ?? {};
  const unresolved = review.items.filter((i) => i.conflict && !resolutions[i.logicalId]);
  if (unresolved.length) {
    throw new AppError(
      409,
      "live_conflict",
      `${unresolved.length} published event${unresolved.length === 1 ? " was" : "s were"} changed after this track last matched the public schedule. Choose what to do with each before publishing.`,
      { review, conflicts: unresolved },
    );
  }

  const apply: ReviewItem[] = [];
  const takeLive: ReviewItem[] = [];
  let skipped = 0;
  for (const item of review.items) {
    const res = item.conflict ? resolutions[item.logicalId] : "overwrite";
    if (res === "skip") skipped++;
    else if (res === "take-live") takeLive.push(item);
    else apply.push(item);
  }
  const phaseChange = !!(review.phases && (review.phases.add.length || review.phases.remove.length));
  const unchangedIds = [...rc.gens.keys()].filter((id) => !review.items.some((i) => i.logicalId === id));

  if (apply.length === 0 && !phaseChange && takeLive.length === 0) {
    for (const id of unchangedIds) await setBaselines(tx, track.id, [id], rc.gens.get(id) ?? 0);
    return { noop: true, published: 0, removed: 0, skipped, tookLive: 0, phasesChanged: false, generation: season.liveGeneration, backupSlot: null };
  }

  let backupSlot: number | null = null;
  let gen = season.liveGeneration;
  if (apply.length || phaseChange) {
    if (input.mode === "replace") {
      const b = await backupBeforeLiveChange(tx, season, review.scope!, {
        includePhases: !!input.includePhases,
        reason: "before-replace",
        actor,
        slot: input.slot,
        operationId: input.operationId,
      });
      backupSlot = b.slot;
    }
    gen = await bumpGeneration(tx, season);
  }

  const now = new Date().toISOString();
  const meta = { action: input.mode === "replace" ? "replace" : "publish", actor, operationId: input.operationId };
  let published = 0;
  let removed = 0;
  for (const item of apply) {
    const prev = rc.live.get(item.logicalId) ?? null;
    if (item.rowId) {
      const r = rc.rows.get(item.rowId)!;
      const payload = projectDoc(rc.ctx, { logicalId: item.logicalId, timezone: r.row.timezone, doc: r.doc, publishedAt: now });
      const notice = carryNotice(prev?.payload ?? null, payload);
      if (notice) payload.notice = notice;
      await writeLive(
        tx,
        season,
        gen,
        { logicalId: item.logicalId, payload, sourceRowId: r.row.id, sourceTrackId: track.id, sourceVersion: r.row.version, locationId: r.doc.locationId, snapshot: r.doc },
        meta,
      );
      await tx.update(events).set({ publishedVersion: r.row.version, publishedAt: now }).where(eq(events.id, r.row.id));
      await recordRevision(tx, {
        eventId: r.row.id,
        version: r.row.version,
        action: "publish",
        summary: item.crossesScope ? `Published (moved ${item.crossesScope === "out" ? "out of" : "into"} the replaced dates)` : input.mode === "replace" ? "Published (schedule replacement)" : "Published",
        snapshot: r.doc,
        userId: actor.id,
      });
      published++;
    } else {
      await writeLive(tx, season, gen, { logicalId: item.logicalId, payload: null }, meta);
      removed++;
    }
    await setBaselines(tx, track.id, [item.logicalId], gen);
  }
  if (phaseChange && rc.trackPhases) await replacePublicPhases(tx, review.scope!, rc.trackPhases);

  for (const item of takeLive) {
    const r = item.rowId ? rc.rows.get(item.rowId)!.row : null;
    await adoptLive(tx, actor, track, item.logicalId, rc.live.get(item.logicalId) ?? null, r, "Updated to match the published version");
    await setBaselines(tx, track.id, [item.logicalId], rc.gens.get(item.logicalId) ?? 0);
  }
  for (const id of unchangedIds) await setBaselines(tx, track.id, [id], rc.gens.get(id) ?? 0);

  const sc = review.scope;
  if (input.mode === "replace" && sc && !sc.from && !sc.to && !sc.kinds && skipped === 0) {
    await tx.update(tracks).set({ baselineGeneration: gen }).where(eq(tracks.id, track.id));
  }

  if (apply.length || phaseChange) {
    await logLive(tx, season, {
      action: meta.action,
      actor,
      publicNote: input.note ?? "",
      count: published + removed,
      operationId: input.operationId,
      details: { trackId: track.id, scope: review.scope, published, removed, skipped, phases: review.phases ? { add: review.phases.add.length, remove: review.phases.remove.length } : null, backupSlot },
    });
  }
  return { noop: false, published, removed, skipped, tookLive: takeLive.length, phasesChanged: phaseChange, generation: gen, backupSlot };
}

/** Publish selected changes or replace a scope. Atomic, idempotent per operation id. */
export async function publish(actor: SessionUser, input: PublishInput): Promise<PublishResult & { replayed?: boolean }> {
  if (!isUuid(input.trackId)) throw badRequest("Choose a planning track.");
  const pre = await seasonAndTrack(getDb(), input.trackId);
  return runOperation(input.operationId, input.mode === "replace" ? "publish-replace" : "publish-selected", actor, pre.seasonId, async (tx) => {
    const season = await lockSeason(tx, pre.seasonId);
    const track = await lockTrack(tx, input.trackId);
    return publishInTx(tx, actor, season, track, input);
  });
}

/** Editor "Save & publish": persist the document and publish it in one transaction. */
export async function saveAndPublish(
  actor: SessionUser,
  id: string,
  input: { baseVersion: number; doc: unknown; note?: string; resolutions?: Record<string, Resolution>; operationId?: string | null },
): Promise<EventRecord> {
  if (!Number.isInteger(input.baseVersion)) throw badRequest("baseVersion is required.");
  const pre = await getEvent(id);
  if (!pre) throw notFound("Event not found. It may have been deleted or cleared.");
  const track = await seasonAndTrack(getDb(), pre.trackId);
  await runOperation(input.operationId, "save-publish", actor, track.seasonId, async (tx) => {
    const season = await lockSeason(tx, track.seasonId);
    const t = await lockTrack(tx, track.id);
    await saveEventTx(tx, actor, id, input.baseVersion, input.doc);
    return publishInTx(tx, actor, season, t, { trackId: t.id, mode: "selected", rowIds: [id], note: input.note, resolutions: input.resolutions, operationId: input.operationId });
  });
  return (await getEvent(id))!;
}

/** Remove this event from the public schedule (the working copy stays as a draft). */
export async function unpublishEvent(
  actor: SessionUser,
  id: string,
  opts: { note?: string; resolutions?: Record<string, Resolution>; operationId?: string | null } = {},
): Promise<EventRecord> {
  const pre = await getEvent(id);
  if (!pre) throw notFound("Event not found.");
  if (!pre.live.present) throw new AppError(409, "not_published", "This event is not on the public schedule.");
  const track = await seasonAndTrack(getDb(), pre.trackId);
  await runOperation(opts.operationId, "unpublish", actor, track.seasonId, async (tx) => {
    const season = await lockSeason(tx, track.seasonId);
    const t = await lockTrack(tx, track.id);
    const row = await lockRow(tx, id);
    const res = await publishInTx(tx, actor, season, t, { trackId: t.id, mode: "selected", rowIds: [], removeLogicalIds: [row.logicalId], note: opts.note, resolutions: opts.resolutions, operationId: opts.operationId });
    if (res.removed) {
      await tx.update(events).set({ publishedVersion: null, publishedAt: null }).where(eq(events.id, id));
      await recordRevision(tx, { eventId: id, version: row.version, action: "unpublish", summary: "Unpublished (removed from the public schedule)", snapshot: rowToDoc(row), userId: actor.id });
    }
    return res;
  });
  return (await getEvent(id))!;
}

/** Throw away this track's unpublished edits: the working copy returns to the live version (private notes kept). */
export async function discardDraftChanges(actor: SessionUser, id: string, baseVersion?: number): Promise<EventRecord> {
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (baseVersion !== undefined && row.version !== baseVersion) throw await conflictFor(tx, row);
    const track = await lockTrack(tx, row.trackId);
    const live = await liveRow(tx, row.logicalId);
    if (!live) throw new AppError(409, "not_published", "Only published events have a public version to return to.");
    await adoptLive(tx, actor, track, row.logicalId, live, row, "Discarded unpublished changes");
    const [le] = await tx.select({ gen: logicalEvents.liveGeneration }).from(logicalEvents).where(eq(logicalEvents.id, row.logicalId)).limit(1);
    await setBaselines(tx, track.id, [row.logicalId], le?.gen ?? 0);
  });
  return (await getEvent(id))!;
}

async function baselineFor(tx: DbOrTx, track: TrackRow, logicalId: string): Promise<number> {
  const [b] = await tx
    .select({ gen: trackBaselines.seenGeneration })
    .from(trackBaselines)
    .where(and(eq(trackBaselines.trackId, track.id), eq(trackBaselines.logicalId, logicalId)))
    .limit(1);
  return b?.gen ?? track.baselineGeneration;
}

async function liveGenerationOf(tx: DbOrTx, logicalId: string): Promise<number> {
  const [le] = await tx.select({ gen: logicalEvents.liveGeneration }).from(logicalEvents).where(eq(logicalEvents.id, logicalId)).limit(1);
  return le?.gen ?? 0;
}

/**
 * Cancel (or reinstate). With `publish`, ONLY the status and reason of the
 * CURRENT live version change — any other unpublished edits stay private.
 */
export async function setCanceled(
  actor: SessionUser,
  id: string,
  input: { canceled: boolean; reason?: string; publish?: boolean; baseVersion?: number; operationId?: string | null },
): Promise<EventRecord> {
  const pre = await getEvent(id);
  if (!pre) throw notFound("Event not found.");
  const trackPre = await seasonAndTrack(getDb(), pre.trackId);
  await runOperation(input.operationId, input.canceled ? "cancel" : "reinstate", actor, trackPre.seasonId, async (tx) => {
    const season = input.publish ? await lockSeason(tx, trackPre.seasonId) : null;
    const track = await lockTrack(tx, trackPre.id);
    const row = await lockRow(tx, id);
    if (input.baseVersion !== undefined && row.version !== input.baseVersion) throw await conflictFor(tx, row);
    const doc = rowToDoc(row);
    const reason = (input.reason ?? "").trim().slice(0, 500);
    const next: EventDoc = { ...doc, status: input.canceled ? "canceled" : "scheduled", cancelReason: input.canceled ? reason : "" };
    const { row: updated } = await saveEventTx(tx, actor, id, row.version, next, {
      action: input.canceled ? "cancel" : "reinstate",
      summary: input.canceled ? `Canceled${reason ? `: ${reason}` : ""}` : "Reinstated (cancellation removed)",
    });
    if (!season) return { published: false };
    const live = await liveRow(tx, row.logicalId);
    if (!live) return { published: false };
    if (live.payload.status === next.status && live.payload.cancelReason === (input.canceled ? reason : "")) return { published: false };
    const prevGen = await liveGenerationOf(tx, row.logicalId);
    const reconciled = (await baselineFor(tx, track, row.logicalId)) >= prevGen;
    const payload: PublicEvent = { ...live.payload, status: next.status, cancelReason: input.canceled ? reason : "", publishedAt: new Date().toISOString() };
    const gen = await bumpGeneration(tx, season);
    await writeLive(
      tx,
      season,
      gen,
      { logicalId: row.logicalId, payload, sourceRowId: live.sourceRowId, sourceTrackId: live.sourceTrackId, sourceVersion: live.sourceVersion, locationId: live.locationId },
      { action: input.canceled ? "cancel" : "reinstate", actor, operationId: input.operationId },
    );
    if (reconciled) await setBaselines(tx, track.id, [row.logicalId], gen);
    await recordRevision(tx, {
      eventId: id,
      version: updated.version,
      action: "publish",
      summary: input.canceled ? "Published the cancellation only (other edits stay private)" : "Published the reinstatement only (other edits stay private)",
      snapshot: rowToDoc(updated),
      userId: actor.id,
    });
    await logLive(tx, season, {
      action: input.canceled ? "cancel" : "reinstate",
      actor,
      publicNote: input.canceled ? `Canceled: ${displayTitle(payload)} (${formatDateMedium(payload.date)})${reason ? ` — ${reason}` : ""}` : `Back on: ${displayTitle(payload)} (${formatDateMedium(payload.date)})`,
      count: 1,
      operationId: input.operationId,
      details: { logicalId: row.logicalId },
    });
    return { published: true };
  });
  return (await getEvent(id))!;
}

// ---------------------------------------------------------------------------
// Delete (to Trash) with an explicit public choice
// ---------------------------------------------------------------------------
export async function deleteEvent(actor: SessionUser, id: string, opts: { unpublish?: boolean; operationId?: string | null } = {}): Promise<{ unpublished: boolean }> {
  const pre = await getEvent(id);
  if (!pre) throw notFound("Event not found. It may have already been deleted.");
  const trackPre = await seasonAndTrack(getDb(), pre.trackId);
  return runOperation(opts.operationId, "delete-event", actor, trackPre.seasonId, async (tx) => {
    const season = opts.unpublish ? await lockSeason(tx, trackPre.seasonId) : null;
    const track = await lockTrack(tx, trackPre.id);
    const row = await lockRow(tx, id);
    const live = season ? await liveRow(tx, row.logicalId) : null;
    if (season && live) {
      const gen = await bumpGeneration(tx, season);
      await writeLive(tx, season, gen, { logicalId: row.logicalId, payload: null }, { action: "delete", actor, operationId: opts.operationId });
      await setBaselines(tx, track.id, [row.logicalId], gen);
      await logLive(tx, season, { action: "delete", actor, count: 1, operationId: opts.operationId, details: { logicalId: row.logicalId } });
    }
    // Version moves forward so a delayed autosave of the pre-delete document is rejected, even after a restore.
    await tx
      .update(events)
      .set({ deletedAt: sql`now()`, deletedBy: actor.id, deletedPublicPayload: live?.payload ?? null, clearBatchId: null, version: row.version + 1 })
      .where(eq(events.id, id));
    await recordRevision(tx, {
      eventId: id,
      version: row.version + 1,
      action: "delete",
      summary: live ? "Moved to Trash (and removed from the public schedule)" : "Moved to Trash",
      snapshot: rowToDoc(row),
      userId: actor.id,
    });
    return { unpublished: !!live };
  });
}

// ---------------------------------------------------------------------------
// Publish a track's phases
// ---------------------------------------------------------------------------
export async function publishPhases(actor: SessionUser, input: { trackId: string; scope?: ScopeInput | null; operationId?: string | null; note?: string }) {
  const pre = await seasonAndTrack(getDb(), input.trackId);
  return runOperation(input.operationId, "publish-phases", actor, pre.seasonId, async (tx) => {
    const season = await lockSeason(tx, pre.seasonId);
    const track = await lockTrack(tx, input.trackId);
    const scope = parseScope(season.id, input.scope);
    const tp = await tx.select().from(phases).where(and(eq(phases.trackId, track.id), isNull(phases.deletedAt))).orderBy(asc(phases.startDate));
    const next = tp.filter((p) => phaseOverlapsScope(scope, p)).map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color }));
    const cur = (await publicPhasesInScope(tx, scope)).map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color }));
    if (canonicalJson(next.map(phaseKey).sort()) === canonicalJson(cur.map(phaseKey).sort())) return { noop: true, count: next.length };
    const gen = await bumpGeneration(tx, season);
    await replacePublicPhases(tx, scope, next);
    await logLive(tx, season, { action: "publish-phases", actor, publicNote: input.note ?? "", count: 0, operationId: input.operationId, details: { trackId: track.id, scope, phases: next.length, generation: gen } });
    return { noop: false, count: next.length };
  });
}

// ---------------------------------------------------------------------------
// Quick logistics update (published events only)
// ---------------------------------------------------------------------------
const optTime = z.union([z.string().refine(isClockTime, "Use a 24-hour time like 15:30"), z.null()]);
export const logisticsValuesSchema = z.object({
  date: z.string().refine(isISODate, "Choose a valid date"),
  startTime: optTime,
  endTime: optTime,
  locationId: z.union([z.uuid(), z.null()]),
  venue: z.string().max(200).transform((s) => s.trim()),
  reportTime: optTime,
  busDepart: optTime,
  busReturn: optTime,
});

const FIELD_LABEL: Record<LogisticsField, string> = {
  date: "date",
  startTime: "start time",
  endTime: "end time",
  venue: "location",
  reportTime: "report time",
  busDepart: "bus departure",
  busReturn: "bus return",
};

function changedLogistics(a: LogisticsValues, b: LogisticsValues): LogisticsField[] {
  return LOGISTICS_FIELDS.filter((f) => (f === "venue" ? a.locationId !== b.locationId || a.venue !== b.venue : a[f] !== b[f]));
}

const fieldEq = (f: LogisticsField, a: LogisticsValues, b: LogisticsValues) => (f === "venue" ? a.venue === b.venue : a[f] === b[f]);

export function noticeText(payload: PublicEvent, fields: LogisticsField[]): string {
  const parts: string[] = [];
  if (fields.includes("date")) parts.push(`Now ${formatDateMedium(payload.date)}`);
  if (fields.includes("startTime") || fields.includes("endTime")) parts.push(payload.startTime ? formatClockRange(payload.startTime, payload.endTime) : "All day");
  if (fields.includes("venue")) parts.push(`at ${payload.location?.name ?? (payload.locationNote || "TBA")}`);
  if (fields.includes("reportTime") && payload.meet?.reportTime) parts.push(`report ${formatClock(payload.meet.reportTime)}`);
  if (fields.includes("busDepart") && payload.meet?.busDepart) parts.push(`bus leaves ${formatClock(payload.meet.busDepart)}`);
  if (fields.includes("busReturn") && payload.meet?.busReturn) parts.push(`bus returns ${formatClock(payload.meet.busReturn)}`);
  return `Updated: ${parts.join(" · ")}`.slice(0, 280);
}

function applyLogistics(p: PublicEvent, fields: LogisticsField[], v: LogisticsValues, ctx: ProjectionCtx): PublicEvent {
  const next: PublicEvent = { ...p, meet: p.meet ? { ...p.meet } : null };
  if (fields.includes("date")) next.date = v.date;
  if (fields.includes("startTime")) next.startTime = v.startTime;
  if (fields.includes("endTime")) next.endTime = v.endTime;
  if (fields.includes("venue")) {
    if (v.locationId) {
      const loc = ctx.locations.get(v.locationId);
      if (!loc) throw badRequest("The selected location no longer exists.");
      next.location = { ...loc };
      next.locationNote = "";
    } else {
      next.location = null;
      next.locationNote = v.venue;
    }
  }
  for (const f of ["reportTime", "busDepart", "busReturn"] as const) {
    if (!fields.includes(f)) continue;
    if (!next.meet) throw badRequest("Report and bus times apply to meets and tournaments only.");
    next.meet[f] = v[f];
  }
  if (next.startTime && next.endTime && next.endTime <= next.startTime) throw badRequest("The end time must be after the start time.");
  if (!next.startTime && next.endTime) throw badRequest("Set a start time before the end time.");
  return next;
}

function patchDocLogistics(doc: EventDoc, fields: LogisticsField[], v: LogisticsValues): EventDoc {
  const next: EventDoc = { ...doc, meet: doc.meet ? { ...doc.meet } : null };
  if (fields.includes("date")) next.date = v.date;
  if (fields.includes("startTime")) next.startTime = v.startTime;
  if (fields.includes("endTime")) next.endTime = v.endTime;
  if (fields.includes("venue")) {
    next.locationId = v.locationId;
    next.locationNote = v.locationId ? "" : v.venue;
  }
  if (next.meet) for (const f of ["reportTime", "busDepart", "busReturn"] as const) if (fields.includes(f)) next.meet[f] = v[f];
  return next;
}

export interface LogisticsInput {
  logicalId: string;
  /** Reconcile this track's working copy (the coach's selected track). */
  trackId?: string | null;
  basedOn: { generation: number; values: LogisticsValues };
  values: LogisticsValues;
  note?: string;
  /** Overwrite live fields that changed since `basedOn` (after the coach saw the conflict). */
  force?: boolean;
  operationId?: string | null;
}

/** Current live logistics for the dialog. */
export async function getLiveLogistics(logicalId: string) {
  if (!isUuid(logicalId)) throw notFound("Event not found.");
  const db = getDb();
  const live = await liveRow(db, logicalId);
  if (!live) throw new AppError(409, "not_published", "Only published events can get a quick logistics update.");
  return { generation: await liveGenerationOf(db, logicalId), values: logisticsOf(live.payload, live.locationId), notice: live.payload.notice ?? null, kind: live.payload.kind, hasMeet: !!live.payload.meet };
}

async function logisticsInTx(tx: Tx, actor: SessionUser, input: LogisticsInput, action: "logistics" | "logistics-undo") {
  const values = logisticsValuesSchema.parse(input.values);
  const basedOn = logisticsValuesSchema.parse(input.basedOn?.values);
  const [le] = await tx.select().from(logicalEvents).where(eq(logicalEvents.id, input.logicalId)).limit(1);
  if (!le) throw notFound("Event not found.");
  const season = await lockSeason(tx, le.seasonId);
  const live = await liveRow(tx, input.logicalId);
  if (!live) throw new AppError(409, "not_published", "Only published events can get a quick logistics update.");
  const ctx = await loadProjectionCtx(tx);
  const current = logisticsOf(live.payload, live.locationId);
  const fields = changedLogistics(basedOn, values);
  if (fields.length === 0) throw badRequest("Nothing to update — change the date, time, location, report time or bus times first.");
  const conflicts = fields
    .filter((f) => !fieldEq(f, current, basedOn) && !fieldEq(f, current, values))
    .map((f) => ({ field: f, label: FIELD_LABEL[f], original: f === "venue" ? basedOn.venue : basedOn[f], yours: f === "venue" ? values.venue : values[f], live: f === "venue" ? current.venue : current[f] }));
  if (conflicts.length && !input.force) {
    throw new AppError(409, "logistics_conflict", `Another coach changed the ${conflicts.map((c) => c.label).join(", ")} of this event after you opened it.`, {
      conflicts,
      generation: le.liveGeneration,
      current,
    });
  }
  const prevGen = le.liveGeneration;
  const now = new Date().toISOString();
  const patched = applyLogistics(live.payload, fields, values, ctx);
  const note = (input.note ?? "").trim().slice(0, 280);
  patched.publishedAt = now;
  patched.notice = { at: now, text: note || (action === "logistics-undo" ? `Earlier change undone. ${noticeText(patched, fields)}` : noticeText(patched, fields)) };
  const gen = await bumpGeneration(tx, season);
  const newLocationId = fields.includes("venue") ? values.locationId : live.locationId;
  const publicationId = await writeLive(
    tx,
    season,
    gen,
    { logicalId: input.logicalId, payload: patched, sourceRowId: live.sourceRowId, sourceTrackId: live.sourceTrackId, sourceVersion: live.sourceVersion, locationId: newLocationId },
    { action, actor, operationId: input.operationId },
  );

  // Reconcile ONLY the changed logistics fields of the coach's working copy; every other draft edit stays.
  let reconciledRowId: string | null = null;
  if (input.trackId && isUuid(input.trackId)) {
    const [variant] = await tx
      .select()
      .from(events)
      .where(and(eq(events.trackId, input.trackId), eq(events.logicalId, input.logicalId), isNull(events.deletedAt)))
      .for("update")
      .limit(1);
    const [track] = await tx.select().from(tracks).where(eq(tracks.id, input.trackId)).limit(1);
    if (variant && track && !track.deletedAt) {
      const wasReconciled = (await baselineFor(tx, track, input.logicalId)) >= prevGen;
      const doc = patchDocLogistics(rowToDoc(variant), fields, values);
      await saveEventTx(tx, actor, variant.id, variant.version, doc, {
        action: "logistics",
        summary: `${action === "logistics-undo" ? "Undid a logistics update" : "Published a logistics update"}: ${fields.map((f) => FIELD_LABEL[f]).join(", ")}`,
      });
      if (wasReconciled) await setBaselines(tx, track.id, [input.logicalId], gen);
      reconciledRowId = variant.id;
    }
  }
  await logLive(tx, season, {
    action,
    actor,
    publicNote: patched.notice.text,
    count: 1,
    operationId: input.operationId,
    details: { logicalId: input.logicalId, fields, publicationId },
  });
  return { publicationId, generation: gen, fields, notice: patched.notice, reconciledRowId, forced: conflicts.length > 0 };
}

export async function publishLogistics(actor: SessionUser, input: LogisticsInput) {
  if (!isUuid(input.logicalId)) throw notFound("Event not found.");
  const [le] = await getDb().select({ seasonId: logicalEvents.seasonId }).from(logicalEvents).where(eq(logicalEvents.id, input.logicalId)).limit(1);
  if (!le) throw notFound("Event not found.");
  return runOperation(input.operationId, "logistics", actor, le.seasonId, (tx) => logisticsInTx(tx, actor, input, "logistics"));
}

/** Undo a logistics update: puts back the previous values of exactly the fields it changed (as a new, recorded update). */
export async function undoLogistics(actor: SessionUser, input: { publicationId: string; trackId?: string | null; force?: boolean; note?: string; operationId?: string | null }) {
  if (!isUuid(input.publicationId)) throw notFound("That update could not be found.");
  const [pub] = await getDb().select().from(eventPublications).where(eq(eventPublications.id, input.publicationId)).limit(1);
  if (!pub || !["logistics", "logistics-undo"].includes(pub.action) || !pub.previousPayload || !pub.payload) throw notFound("That update could not be found.");
  const ctx = await loadProjectionCtx(getDb());
  const locIdFor = (p: PublicEvent) => {
    if (!p.location) return null;
    for (const [id, l] of ctx.locations) if (l.name === p.location.name && l.address === p.location.address) return id;
    return null;
  };
  const after = logisticsOf(pub.payload, locIdFor(pub.payload));
  const before = logisticsOf(pub.previousPayload, locIdFor(pub.previousPayload));
  if (before.venue !== after.venue && pub.previousPayload.location && !before.locationId) {
    // the earlier venue no longer exists as a shared location: restore it as free text
    before.venue = pub.previousPayload.location.name;
  }
  return runOperation(input.operationId, "logistics-undo", actor, pub.seasonId, (tx) =>
    logisticsInTx(tx, actor, { logicalId: pub.logicalId, trackId: input.trackId, basedOn: { generation: pub.generation, values: after }, values: before, note: input.note, force: input.force, operationId: input.operationId }, "logistics-undo"),
  );
}

/** Public-change history of one logical event (coach-only), newest first. */
export async function listPublications(logicalId: string) {
  if (!isUuid(logicalId)) return [];
  const rows = await getDb()
    .select({
      id: eventPublications.id,
      action: eventPublications.action,
      generation: eventPublications.generation,
      createdAt: eventPublications.createdAt,
      sourceTrackId: eventPublications.sourceTrackId,
      trackName: tracks.name,
      userName: users.name,
      previousPayload: eventPublications.previousPayload,
      payload: eventPublications.payload,
    })
    .from(eventPublications)
    .leftJoin(users, eq(users.id, eventPublications.userId))
    .leftJoin(tracks, eq(tracks.id, eventPublications.sourceTrackId))
    .where(eq(eventPublications.logicalId, logicalId))
    .orderBy(desc(eventPublications.createdAt))
    .limit(100);
  const [latest] = rows;
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    generation: r.generation,
    createdAt: r.createdAt,
    trackName: r.trackName,
    userName: r.userName,
    summary:
      r.previousPayload && r.payload
        ? diffTags(r.previousPayload, r.payload).join(", ") || "no visible change"
        : r.payload
          ? "added to the public schedule"
          : "removed from the public schedule",
    notice: r.payload?.notice && (r.action === "logistics" || r.action === "logistics-undo") ? r.payload.notice.text : null,
    canUndo: (r.action === "logistics" || r.action === "logistics-undo") && !!r.payload && !!r.previousPayload,
    isLatest: r.id === latest?.id,
  }));
}
