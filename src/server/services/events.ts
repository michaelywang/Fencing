import "server-only";
import { and, asc, between, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { eventRevisions, events, logicalEvents, publicEvents, trackBaselines, tracks, users, type EventContent } from "@/server/db/schema";
import { eventDocSchema, type EventDoc } from "@/lib/schemas";
import type { PublicEvent } from "@/lib/projection";
import { addDays, diffDays, isISODate } from "@/lib/dates";
import { newBlockId } from "@/lib/practice";
import type { PublicationState } from "@/lib/constants";
import type { EventRecord, LiveInfo } from "@/lib/view";
import { AppError, ConflictError, badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { loadProjectionCtx, projectDoc, type ProjectionCtx } from "@/server/live/project";
import { publicContentHash } from "@/server/live/hash";
import { getLocation, getSettings } from "./settings";
import { lockTrack, requireActiveTrack } from "./scope";
import { isUuid } from "./ids";

export { isUuid };
export type { EventRecord, EventMeta } from "@/lib/view";

export type EventRow = typeof events.$inferSelect;

// ---------------------------------------------------------------------------
// Row <-> document mapping
// ---------------------------------------------------------------------------
export function rowToDoc(row: EventRow): EventDoc {
  const merged = {
    ...(row.content as object),
    kind: row.kind,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    title: row.title,
    confirmation: row.confirmation,
    status: row.status,
    locationId: row.locationId,
    privateNotes: row.privateNotes,
    completedNotes: row.completedNotes,
  };
  const parsed = eventDocSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  console.warn(`[events] stored document ${row.id} failed validation; returning best effort`, parsed.error.issues[0]);
  return merged as unknown as EventDoc;
}

export function docToColumns(doc: EventDoc) {
  const { kind, date, startTime, endTime, title, confirmation, status, locationId, privateNotes, completedNotes, ...content } = doc;
  return { kind, date, startTime, endTime, title, confirmation, status, locationId, privateNotes, completedNotes, content: content as EventContent };
}

interface LiveJoin {
  livePayload: PublicEvent | null;
  liveSourceTrackId: string | null;
  liveGeneration: number | null;
  baseline: number | null;
  trackBaseline: number | null;
}

/**
 * Publication state is CONTENT based, so it is meaningful across tracks:
 * draft = nothing live for this logical event; published = this working copy
 * would publish exactly what students see now; changed = it differs.
 */
export function publicationAndLive(row: EventRow, doc: EventDoc, j: LiveJoin, ctx: ProjectionCtx): { publication: PublicationState; live: LiveInfo } {
  const generation = j.liveGeneration ?? 0;
  const baseline = j.baseline ?? j.trackBaseline ?? 0;
  if (!j.livePayload) {
    return {
      publication: "draft",
      live: { present: false, date: null, startTime: null, status: null, sourceTrackId: null, generation, changedSinceBaseline: generation > baseline },
    };
  }
  const mine = projectDoc(ctx, { logicalId: row.logicalId, timezone: row.timezone, doc, publishedAt: "" });
  const same = publicContentHash(mine) === publicContentHash(j.livePayload);
  return {
    publication: same ? "published" : "changed",
    live: {
      present: true,
      date: j.livePayload.date,
      startTime: j.livePayload.startTime,
      status: j.livePayload.status,
      sourceTrackId: j.liveSourceTrackId,
      generation,
      changedSinceBaseline: !same && generation > baseline,
    },
  };
}

function toRecord(row: EventRow, j: LiveJoin, ctx: ProjectionCtx, names: { createdByName?: string | null; updatedByName?: string | null } = {}): EventRecord {
  const doc = rowToDoc(row);
  const { publication, live } = publicationAndLive(row, doc, j, ctx);
  return {
    ...doc,
    id: row.id,
    trackId: row.trackId,
    logicalId: row.logicalId,
    live,
    timezone: row.timezone,
    version: row.version,
    publishedVersion: row.publishedVersion,
    publishedAt: j.livePayload?.publishedAt ?? null,
    publication,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: names.createdByName ?? null,
    updatedByName: names.updatedByName ?? null,
    deletedAt: row.deletedAt,
    externalRef: row.externalRef,
  };
}

const creator = alias(users, "creator");
const updater = alias(users, "updater");

export async function selectRecords(db: DbOrTx, where: SQL | undefined, ctx?: ProjectionCtx): Promise<EventRecord[]> {
  const rows = await db
    .select({
      row: events,
      createdByName: creator.name,
      updatedByName: updater.name,
      livePayload: publicEvents.payload,
      liveSourceTrackId: publicEvents.sourceTrackId,
      liveGeneration: logicalEvents.liveGeneration,
      baseline: trackBaselines.seenGeneration,
      trackBaseline: tracks.baselineGeneration,
    })
    .from(events)
    .innerJoin(tracks, eq(tracks.id, events.trackId))
    .innerJoin(logicalEvents, eq(logicalEvents.id, events.logicalId))
    .leftJoin(publicEvents, eq(publicEvents.logicalId, events.logicalId))
    .leftJoin(trackBaselines, and(eq(trackBaselines.trackId, events.trackId), eq(trackBaselines.logicalId, events.logicalId)))
    .leftJoin(creator, eq(creator.id, events.createdBy))
    .leftJoin(updater, eq(updater.id, events.updatedBy))
    .where(where)
    .orderBy(asc(events.date), sql`${events.startTime} NULLS FIRST`, asc(events.createdAt));
  if (rows.length === 0) return [];
  const projection = ctx ?? (await loadProjectionCtx(db));
  return rows.map((r) => toRecord(r.row, r, projection, r));
}

// ---------------------------------------------------------------------------
// Change summaries for revision history
// ---------------------------------------------------------------------------
const FIELD_LABELS: Record<string, string> = {
  kind: "type",
  date: "date",
  startTime: "start time",
  endTime: "end time",
  title: "title",
  confirmation: "confirmation",
  status: "status",
  cancelReason: "cancellation reason",
  locationId: "location",
  locationNote: "venue",
  theme: "theme",
  intensity: "intensity",
  targetMinutes: "target duration",
  objectives: "objectives",
  announcement: "announcement",
  equipment: "equipment",
  weaponSummaries: "weapon summaries",
  coachAssignments: "coach assignments",
  levelNotes: "level notes",
  meet: "meet details",
  links: "links",
  blocks: "practice plan",
  privateNotes: "private notes",
  completedNotes: "completed notes",
};

export function changedFields(a: EventDoc, b: EventDoc): string[] {
  const out: string[] = [];
  for (const key of Object.keys(FIELD_LABELS) as Array<keyof EventDoc>) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) out.push(FIELD_LABELS[key]);
  }
  return out;
}

const COALESCE_MINUTES = 10;

export async function recordRevision(
  tx: Tx,
  input: { eventId: string; version: number; action: string; summary: string; snapshot: EventDoc; userId: string | null; coalesce?: boolean },
) {
  if (input.coalesce) {
    const [latest] = await tx
      .select()
      .from(eventRevisions)
      .where(eq(eventRevisions.eventId, input.eventId))
      .orderBy(desc(eventRevisions.createdAt))
      .limit(1);
    if (latest && latest.action === "edit" && latest.userId === input.userId && Date.now() - new Date(latest.updatedAt).getTime() < COALESCE_MINUTES * 60_000) {
      const merged = [...new Set([...latest.summary.split(", ").filter(Boolean), ...input.summary.split(", ").filter(Boolean)])].join(", ");
      await tx
        .update(eventRevisions)
        .set({ version: input.version, snapshot: input.snapshot, summary: merged, updatedAt: sql`now()` })
        .where(eq(eventRevisions.id, latest.id));
      return;
    }
  }
  await tx.insert(eventRevisions).values({
    eventId: input.eventId,
    version: input.version,
    action: input.action,
    summary: input.summary,
    snapshot: input.snapshot,
    userId: input.userId,
  });
}

export async function lockRow(tx: Tx, id: string, opts: { allowDeleted?: boolean } = {}): Promise<EventRow> {
  if (!isUuid(id)) throw notFound("Event not found.");
  const [row] = await tx.select().from(events).where(eq(events.id, id)).for("update").limit(1);
  if (!row || (row.deletedAt && !opts.allowDeleted)) throw notFound("Event not found. It may have been deleted or cleared.");
  return row;
}

export async function conflictFor(tx: Tx, row: EventRow): Promise<ConflictError> {
  const [rec] = await selectRecords(tx, eq(events.id, row.id));
  return new ConflictError({ current: rec });
}

async function validateRefs(db: DbOrTx, doc: EventDoc) {
  if (doc.locationId && !(await getLocation(doc.locationId, db))) {
    throw badRequest("The selected location no longer exists.");
  }
}

// ---------------------------------------------------------------------------
// Queries (always within one track)
// ---------------------------------------------------------------------------
export async function listEvents(range: { trackId: string; from: string; to: string }, db: DbOrTx = getDb()): Promise<EventRecord[]> {
  if (!isISODate(range.from) || !isISODate(range.to)) throw badRequest("Invalid date range.");
  if (diffDays(range.from, range.to) > 400) throw badRequest("Date range is too large.");
  if (!isUuid(range.trackId)) throw badRequest("Choose a planning track.");
  return selectRecords(db, and(eq(events.trackId, range.trackId), isNull(events.deletedAt), between(events.date, range.from, range.to)));
}

/** Every active event of a track (all dates). Bounded by the bulk-size limit. */
export async function listTrackEvents(trackId: string, db: DbOrTx = getDb()): Promise<EventRecord[]> {
  if (!isUuid(trackId)) return [];
  return selectRecords(db, and(eq(events.trackId, trackId), isNull(events.deletedAt)));
}

export async function getEvent(id: string, db: DbOrTx = getDb()): Promise<EventRecord | null> {
  if (!isUuid(id)) return null;
  const [rec] = await selectRecords(db, and(eq(events.id, id), isNull(events.deletedAt)));
  return rec ?? null;
}

/** Same logical event in another track (for switching tracks while viewing an event). */
export async function findVariant(logicalId: string, trackId: string, db: DbOrTx = getDb()): Promise<string | null> {
  if (!isUuid(logicalId) || !isUuid(trackId)) return null;
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.logicalId, logicalId), eq(events.trackId, trackId), isNull(events.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Create / save
// ---------------------------------------------------------------------------
export interface CreateOptions {
  trackId: string;
  /** Reuse an existing logical identity (another track's variant, an import key, a restore). */
  logicalId?: string | null;
  action?: "create" | "duplicate" | "import" | "template" | "copy-track" | "from-published" | "from-backup";
  summary?: string;
  externalRef?: string | null;
  isDemo?: boolean;
  /** Live generation this row has already reconciled with (copied from another track or from live). */
  baselineGeneration?: number | null;
}

export async function createEventTx(tx: Tx, actor: SessionUser | null, input: unknown, opts: CreateOptions): Promise<EventRow> {
  const doc = eventDocSchema.parse(input);
  await validateRefs(tx, doc);
  const track = await requireActiveTrack(opts.trackId, tx);
  const settings = await getSettings(tx);
  let logicalId = opts.logicalId ?? null;
  if (logicalId) {
    const [le] = await tx.select().from(logicalEvents).where(eq(logicalEvents.id, logicalId)).limit(1);
    if (!le) {
      await tx.insert(logicalEvents).values({ id: logicalId, seasonId: track.seasonId });
    } else if (le.seasonId !== track.seasonId) {
      logicalId = null; // identities never cross seasons
    }
  }
  if (!logicalId) {
    const [le] = await tx.insert(logicalEvents).values({ seasonId: track.seasonId }).returning({ id: logicalEvents.id });
    logicalId = le.id;
  }
  const [row] = await tx
    .insert(events)
    .values({
      ...docToColumns(doc),
      timezone: settings.timezone,
      version: 1,
      trackId: track.id,
      logicalId,
      externalRef: opts.externalRef ?? null,
      isDemo: opts.isDemo ?? false,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    })
    .returning();
  if (opts.baselineGeneration != null) await setBaselines(tx, track.id, [logicalId], opts.baselineGeneration);
  await recordRevision(tx, {
    eventId: row.id,
    version: 1,
    action: opts.action ?? "create",
    summary: opts.summary ?? "Created",
    snapshot: doc,
    userId: actor?.id ?? null,
  });
  return row;
}

export async function setBaselines(tx: Tx, trackId: string, logicalIds: string[], generation: number) {
  if (logicalIds.length === 0) return;
  for (let i = 0; i < logicalIds.length; i += 500) {
    const chunk = logicalIds.slice(i, i + 500);
    await tx
      .insert(trackBaselines)
      .values(chunk.map((logicalId) => ({ trackId, logicalId, seenGeneration: generation })))
      .onConflictDoUpdate({ target: [trackBaselines.trackId, trackBaselines.logicalId], set: { seenGeneration: sql`greatest(${trackBaselines.seenGeneration}, excluded.seen_generation)` } });
  }
}

export async function createEvent(actor: SessionUser, input: unknown, opts: CreateOptions): Promise<EventRecord> {
  const row = await getDb().transaction((tx) => createEventTx(tx, actor, input, opts));
  return (await getEvent(row.id))!;
}

export async function saveEventTx(
  tx: Tx,
  actor: SessionUser | null,
  id: string,
  baseVersion: number | null,
  input: unknown,
  opts: { action?: string; summary?: string } = {},
): Promise<{ row: EventRow; changed: string[] }> {
  const doc = eventDocSchema.parse(input);
  const row = await lockRow(tx, id);
  const [t] = await tx.select({ name: tracks.name, deletedAt: tracks.deletedAt }).from(tracks).where(eq(tracks.id, row.trackId)).limit(1);
  if (t?.deletedAt) throw new AppError(409, "track_removed", `“${t.name}” was removed, so its events can't be edited. Restore the track from Trash first.`);
  if (baseVersion !== null && row.version !== baseVersion) throw await conflictFor(tx, row);
  const prev = rowToDoc(row);
  const changed = changedFields(prev, doc);
  if (changed.length === 0) return { row, changed };
  await validateRefs(tx, doc);
  const [updated] = await tx
    .update(events)
    .set({ ...docToColumns(doc), version: row.version + 1, updatedBy: actor?.id ?? null, updatedAt: sql`now()` })
    .where(eq(events.id, id))
    .returning();
  const action = opts.action ?? "edit";
  await recordRevision(tx, {
    eventId: id,
    version: updated.version,
    action,
    summary: opts.summary ?? changed.join(", "),
    snapshot: doc,
    userId: actor?.id ?? null,
    coalesce: action === "edit",
  });
  return { row: updated, changed };
}

/** Autosave / explicit save with optimistic concurrency (409 ConflictError on a stale baseVersion). */
export async function saveEvent(actor: SessionUser, id: string, input: { baseVersion: number; doc: unknown }): Promise<EventRecord> {
  if (!Number.isInteger(input.baseVersion)) throw badRequest("baseVersion is required.");
  await getDb().transaction((tx) => saveEventTx(tx, actor, id, input.baseVersion, input.doc));
  return (await getEvent(id))!;
}

/** Move to another date in the SAME track (local wall-clock times kept; logical id/URL unchanged). */
export async function moveEvent(actor: SessionUser, id: string, input: { baseVersion: number; date: string }): Promise<EventRecord> {
  if (!isISODate(input.date)) throw badRequest("Invalid date.");
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.version !== input.baseVersion) throw await conflictFor(tx, row);
    const doc = rowToDoc(row);
    await saveEventTx(tx, actor, id, input.baseVersion, { ...doc, date: input.date }, { action: "move", summary: `Moved from ${doc.date} to ${input.date}` });
  });
  return (await getEvent(id))!;
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------
export async function listRevisions(eventId: string) {
  if (!isUuid(eventId)) return [];
  return getDb()
    .select({
      id: eventRevisions.id,
      version: eventRevisions.version,
      action: eventRevisions.action,
      summary: eventRevisions.summary,
      createdAt: eventRevisions.createdAt,
      updatedAt: eventRevisions.updatedAt,
      userName: users.name,
    })
    .from(eventRevisions)
    .leftJoin(users, eq(users.id, eventRevisions.userId))
    .where(eq(eventRevisions.eventId, eventId))
    .orderBy(desc(eventRevisions.updatedAt))
    .limit(200);
}

export async function getRevision(eventId: string, revisionId: string) {
  if (!isUuid(eventId) || !isUuid(revisionId)) return null;
  const [rev] = await getDb()
    .select()
    .from(eventRevisions)
    .where(and(eq(eventRevisions.id, revisionId), eq(eventRevisions.eventId, eventId)))
    .limit(1);
  return rev ?? null;
}

/** Restores an old version as a NEW version of the working copy (private; publish separately). */
export async function restoreRevision(actor: SessionUser, eventId: string, revisionId: string, baseVersion?: number): Promise<EventRecord> {
  const rev = await getRevision(eventId, revisionId);
  if (!rev) throw notFound("That version could not be found.");
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, eventId);
    if (baseVersion !== undefined && row.version !== baseVersion) throw await conflictFor(tx, row);
    const when = new Date(rev.updatedAt).toISOString().slice(0, 16).replace("T", " ");
    await saveEventTx(tx, actor, eventId, row.version, rev.snapshot, { action: "restore", summary: `Restored the version from ${when} UTC` });
  });
  return (await getEvent(eventId))!;
}

// ---------------------------------------------------------------------------
// Duplication to NEW dates (intentional resets; distinct from faithful track copies)
// ---------------------------------------------------------------------------
export interface CopyOptions {
  copyCoaches?: boolean;
  copyNotes?: boolean;
}

/**
 * Prepare a copy of a document for a new date. Times are LOCAL wall-clock
 * times, so they are preserved exactly across daylight-saving changes.
 * Private notes and coach assignments are only copied when asked; completed
 * notes and cancellation never carry over. (Track duplication does NOT use
 * this — it copies documents faithfully.)
 */
export function prepareCopy(doc: EventDoc, date: string, opts: CopyOptions = {}): EventDoc {
  return {
    ...doc,
    date,
    status: "scheduled",
    cancelReason: "",
    completedNotes: "",
    privateNotes: opts.copyNotes ? doc.privateNotes : "",
    coachAssignments: opts.copyCoaches ? { ...doc.coachAssignments } : { shared: "", foil: "", epee: "", saber: "" },
    blocks: doc.blocks.map((b) => ({
      ...b,
      id: newBlockId(),
      coach: opts.copyCoaches ? b.coach : "",
      privateNotes: opts.copyNotes ? b.privateNotes : "",
    })),
  };
}

export async function duplicateEvent(actor: SessionUser, id: string, input: { dates: string[] } & CopyOptions): Promise<string[]> {
  const dates = [...new Set(input.dates ?? [])];
  if (dates.length === 0 || dates.length > 60 || !dates.every(isISODate)) throw badRequest("Choose between 1 and 60 valid dates.");
  const source = await getEvent(id);
  if (!source) throw notFound("Event not found.");
  return getDb().transaction(async (tx) => {
    const ids: string[] = [];
    for (const date of dates.sort()) {
      const row = await createEventTx(tx, actor, prepareCopy(source, date, input), {
        trackId: source.trackId,
        action: "duplicate",
        summary: `Copied from ${source.date}`,
      });
      ids.push(row.id);
    }
    return ids;
  });
}

export async function duplicateWeek(
  actor: SessionUser,
  input: { trackId: string; sourceWeekStart: string; targetWeekStart: string } & CopyOptions,
): Promise<string[]> {
  if (!isISODate(input.sourceWeekStart) || !isISODate(input.targetWeekStart)) throw badRequest("Invalid week.");
  const shift = diffDays(input.sourceWeekStart, input.targetWeekStart);
  if (shift === 0) throw badRequest("Choose a different target week.");
  const sources = await listEvents({ trackId: input.trackId, from: input.sourceWeekStart, to: addDays(input.sourceWeekStart, 6) });
  if (sources.length === 0) throw badRequest("There are no events in the source week.");
  return getDb().transaction(async (tx) => {
    await lockTrack(tx, input.trackId);
    const ids: string[] = [];
    for (const src of sources) {
      const row = await createEventTx(tx, actor, prepareCopy(src, addDays(src.date, shift), input), {
        trackId: input.trackId,
        action: "duplicate",
        summary: `Copied with week of ${input.sourceWeekStart}`,
      });
      ids.push(row.id);
    }
    return ids;
  });
}

/** Rows by id (any state), for bulk services. */
export async function rowsByIds(tx: DbOrTx, ids: string[]): Promise<EventRow[]> {
  if (ids.length === 0) return [];
  return tx.select().from(events).where(inArray(events.id, ids));
}
