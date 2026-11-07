import "server-only";
import { and, asc, between, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { eventRevisions, events, publicEvents, publishLog, users, type EventContent } from "@/server/db/schema";
import { eventDocSchema, type EventDoc } from "@/lib/schemas";
import { toPublicEvent, type PublicEvent } from "@/lib/projection";
import { addDays, diffDays, isISODate } from "@/lib/dates";
import { newBlockId } from "@/lib/practice";
import type { PublicationState } from "@/lib/constants";
import { AppError, ConflictError, badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { getLocation, getSettings } from "./settings";

type EventRow = typeof events.$inferSelect;

import type { EventRecord } from "@/lib/view";
export type { EventRecord, EventMeta } from "@/lib/view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

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

function docToColumns(doc: EventDoc) {
  const {
    kind,
    date,
    startTime,
    endTime,
    title,
    confirmation,
    status,
    locationId,
    privateNotes,
    completedNotes,
    ...content
  } = doc;
  return {
    kind,
    date,
    startTime,
    endTime,
    title,
    confirmation,
    status,
    locationId,
    privateNotes,
    completedNotes,
    content: content as EventContent,
  };
}

function publicationOf(row: Pick<EventRow, "publishedVersion" | "version">): PublicationState {
  if (row.publishedVersion == null) return "draft";
  return row.publishedVersion === row.version ? "published" : "changed";
}

function toRecord(row: EventRow, names: { createdByName?: string | null; updatedByName?: string | null } = {}): EventRecord {
  return {
    ...rowToDoc(row),
    id: row.id,
    timezone: row.timezone,
    version: row.version,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt,
    publication: publicationOf(row),
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

async function selectRecords(db: DbOrTx, where: ReturnType<typeof and>): Promise<EventRecord[]> {
  const rows = await db
    .select({ row: events, createdByName: creator.name, updatedByName: updater.name })
    .from(events)
    .leftJoin(creator, eq(creator.id, events.createdBy))
    .leftJoin(updater, eq(updater.id, events.updatedBy))
    .where(where)
    .orderBy(asc(events.date), sql`${events.startTime} NULLS FIRST`, asc(events.createdAt));
  return rows.map((r) => toRecord(r.row, r));
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

async function recordRevision(
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
    if (
      latest &&
      latest.action === "edit" &&
      latest.userId === input.userId &&
      Date.now() - new Date(latest.updatedAt).getTime() < COALESCE_MINUTES * 60_000
    ) {
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

async function lockRow(tx: Tx, id: string): Promise<EventRow> {
  if (!isUuid(id)) throw notFound("Event not found.");
  const [row] = await tx.select().from(events).where(eq(events.id, id)).for("update").limit(1);
  if (!row || row.deletedAt) throw notFound("Event not found. It may have been deleted.");
  return row;
}

async function conflictFor(tx: Tx, row: EventRow): Promise<ConflictError> {
  const [names] = await tx
    .select({ updatedByName: users.name })
    .from(users)
    .where(eq(users.id, row.updatedBy ?? "00000000-0000-0000-0000-000000000000"))
    .limit(1);
  return new ConflictError({ current: toRecord(row, { updatedByName: names?.updatedByName ?? null }) });
}

async function validateRefs(db: DbOrTx, doc: EventDoc) {
  if (doc.locationId && !(await getLocation(doc.locationId, db))) {
    throw badRequest("The selected location no longer exists.");
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export async function listEvents(range: { from: string; to: string }, db: DbOrTx = getDb()): Promise<EventRecord[]> {
  if (!isISODate(range.from) || !isISODate(range.to)) throw badRequest("Invalid date range.");
  if (diffDays(range.from, range.to) > 400) throw badRequest("Date range is too large.");
  return selectRecords(db, and(isNull(events.deletedAt), between(events.date, range.from, range.to)));
}

export async function getEvent(id: string, db: DbOrTx = getDb()): Promise<EventRecord | null> {
  if (!isUuid(id)) return null;
  const [rec] = await selectRecords(db, and(eq(events.id, id), isNull(events.deletedAt)));
  return rec ?? null;
}

/** Every non-deleted event (used by the administrator export). */
export async function listAllEvents(db: DbOrTx = getDb()): Promise<EventRecord[]> {
  return selectRecords(db, isNull(events.deletedAt));
}

export async function listTrash(db: DbOrTx = getDb()): Promise<EventRecord[]> {
  return selectRecords(db, and(isNotNull(events.deletedAt), gte(events.deletedAt, sql`now() - interval '90 days'`)));
}

export async function listDrafts(fromDate: string, db: DbOrTx = getDb()): Promise<EventRecord[]> {
  const rows = await selectRecords(db, and(isNull(events.deletedAt), gte(events.date, fromDate)));
  return rows.filter((r) => r.publication !== "published");
}

// ---------------------------------------------------------------------------
// Create / save
// ---------------------------------------------------------------------------
export interface CreateOptions {
  action?: "create" | "duplicate" | "import" | "template";
  summary?: string;
  externalRef?: string | null;
  isDemo?: boolean;
}

export async function createEventTx(tx: Tx, actor: SessionUser | null, input: unknown, opts: CreateOptions = {}): Promise<EventRow> {
  const doc = eventDocSchema.parse(input);
  await validateRefs(tx, doc);
  const settings = await getSettings(tx);
  const [row] = await tx
    .insert(events)
    .values({
      ...docToColumns(doc),
      timezone: settings.timezone,
      version: 1,
      externalRef: opts.externalRef ?? null,
      isDemo: opts.isDemo ?? false,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    })
    .returning();
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

export async function createEvent(actor: SessionUser, input: unknown, opts: CreateOptions = {}): Promise<EventRecord> {
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
export async function saveEvent(
  actor: SessionUser,
  id: string,
  input: { baseVersion: number; doc: unknown },
): Promise<EventRecord> {
  if (!Number.isInteger(input.baseVersion)) throw badRequest("baseVersion is required.");
  await getDb().transaction((tx) => saveEventTx(tx, actor, id, input.baseVersion, input.doc));
  return (await getEvent(id))!;
}

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
// Publishing
// ---------------------------------------------------------------------------
async function writePublic(tx: Tx, actor: SessionUser | null, row: EventRow, doc: EventDoc, sourceVersion: number) {
  const settings = await getSettings(tx);
  const location = doc.locationId ? await getLocation(doc.locationId, tx) : null;
  const publishedAt = new Date().toISOString();
  const payload = toPublicEvent(doc, {
    id: row.id,
    timezone: row.timezone,
    location: location ? { name: location.name, shortName: location.shortName, address: location.address } : null,
    showCoachNames: settings.showCoachNamesPublicly,
    publishedAt,
  });
  await tx
    .insert(publicEvents)
    .values({
      eventId: row.id,
      date: doc.date,
      startTime: doc.startTime,
      kind: doc.kind,
      status: doc.status,
      payload,
      sourceVersion,
      publishedAt,
      publishedBy: actor?.id ?? null,
    })
    .onConflictDoUpdate({
      target: publicEvents.eventId,
      set: { date: doc.date, startTime: doc.startTime, kind: doc.kind, status: doc.status, payload, sourceVersion, publishedAt, publishedBy: actor?.id ?? null },
    });
  return publishedAt;
}

async function logPublish(tx: Tx, actor: SessionUser | null, action: string, note: string, count: number) {
  await tx.insert(publishLog).values({ userId: actor?.id ?? null, action, note: note.slice(0, 280), eventCount: count });
}

async function publishRowTx(tx: Tx, actor: SessionUser | null, row: EventRow) {
  const doc = rowToDoc(row);
  const publishedAt = await writePublic(tx, actor, row, doc, row.version);
  await tx.update(events).set({ publishedVersion: row.version, publishedAt }).where(eq(events.id, row.id));
  await recordRevision(tx, { eventId: row.id, version: row.version, action: "publish", summary: "Published", snapshot: doc, userId: actor?.id ?? null });
}

/**
 * Publish the CURRENT working copies of the given events (a day or a week).
 * `expectedVersions` lets the caller assert it is publishing what it reviewed.
 */
export async function publishEvents(
  actor: SessionUser,
  ids: string[],
  opts: { note?: string; expectedVersions?: Record<string, number> } = {},
): Promise<{ published: number }> {
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0) throw badRequest("Choose at least one event to publish.");
  if (unique.length > 100) throw badRequest("Publish at most 100 events at a time.");
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(events)
      .where(and(inArray(events.id, unique), isNull(events.deletedAt)))
      .orderBy(asc(events.id))
      .for("update");
    if (rows.length !== unique.length) throw notFound("Some events no longer exist. Refresh and try again.");
    for (const row of rows) {
      const expected = opts.expectedVersions?.[row.id];
      if (expected !== undefined && expected !== row.version) throw await conflictFor(tx, row);
      await publishRowTx(tx, actor, row);
    }
    await logPublish(tx, actor, "publish", opts.note ?? "", rows.length);
    return { published: rows.length };
  });
}

/** "Save & publish": persist the editor's document and make it public in one transaction. */
export async function saveAndPublish(
  actor: SessionUser,
  id: string,
  input: { baseVersion: number; doc: unknown; note?: string },
): Promise<EventRecord> {
  await getDb().transaction(async (tx) => {
    const { row } = await saveEventTx(tx, actor, id, input.baseVersion, input.doc);
    await publishRowTx(tx, actor, row);
    await logPublish(tx, actor, "publish", input.note ?? "", 1);
  });
  return (await getEvent(id))!;
}

export async function unpublishEvent(actor: SessionUser, id: string, opts: { note?: string } = {}): Promise<EventRecord> {
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.publishedVersion == null) throw new AppError(409, "not_published", "This event is not published.");
    await tx.delete(publicEvents).where(eq(publicEvents.eventId, id));
    await tx.update(events).set({ publishedVersion: null, publishedAt: null }).where(eq(events.id, id));
    await recordRevision(tx, { eventId: id, version: row.version, action: "unpublish", summary: "Unpublished (removed from the public calendar)", snapshot: rowToDoc(row), userId: actor.id });
    await logPublish(tx, actor, "unpublish", opts.note ?? "", 1);
  });
  return (await getEvent(id))!;
}

async function latestPublishedSnapshot(tx: Tx, eventId: string): Promise<EventDoc | null> {
  const [rev] = await tx
    .select()
    .from(eventRevisions)
    .where(and(eq(eventRevisions.eventId, eventId), eq(eventRevisions.action, "publish")))
    .orderBy(desc(eventRevisions.createdAt))
    .limit(1);
  return rev ? eventDocSchema.parse(rev.snapshot) : null;
}

/** Throw away unpublished edits: the working copy returns to the live public version. */
export async function discardDraftChanges(actor: SessionUser, id: string, baseVersion?: number): Promise<EventRecord> {
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (baseVersion !== undefined && row.version !== baseVersion) throw await conflictFor(tx, row);
    if (row.publishedVersion == null) throw new AppError(409, "not_published", "Only published events have a public version to return to.");
    if (row.publishedVersion === row.version) return;
    const snapshot = await latestPublishedSnapshot(tx, id);
    if (!snapshot) throw new AppError(409, "no_snapshot", "The published version could not be found in history.");
    const { row: updated } = await saveEventTx(tx, actor, id, row.version, snapshot, { action: "discard", summary: "Discarded unpublished changes" });
    await tx.update(events).set({ publishedVersion: updated.version }).where(eq(events.id, id));
  });
  return (await getEvent(id))!;
}

/**
 * Cancel (or reinstate) an event. When `publish` is true and the event is
 * public, ONLY the status/reason of the public version changes — any other
 * unpublished draft edits stay private.
 */
export async function setCanceled(
  actor: SessionUser,
  id: string,
  input: { canceled: boolean; reason?: string; publish?: boolean; baseVersion?: number },
): Promise<EventRecord> {
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (input.baseVersion !== undefined && row.version !== input.baseVersion) throw await conflictFor(tx, row);
    const wasInSync = row.publishedVersion != null && row.publishedVersion === row.version;
    const doc = rowToDoc(row);
    const reason = (input.reason ?? "").trim().slice(0, 500);
    const next: EventDoc = { ...doc, status: input.canceled ? "canceled" : "scheduled", cancelReason: input.canceled ? reason : "" };
    const { row: updated } = await saveEventTx(tx, actor, id, row.version, next, {
      action: input.canceled ? "cancel" : "reinstate",
      summary: input.canceled ? `Canceled${reason ? `: ${reason}` : ""}` : "Reinstated (cancellation removed)",
    });
    if (input.publish && row.publishedVersion != null) {
      const published = wasInSync ? doc : (await latestPublishedSnapshot(tx, id)) ?? doc;
      const patched: EventDoc = { ...published, status: next.status, cancelReason: next.cancelReason };
      const sourceVersion = wasInSync ? updated.version : row.publishedVersion;
      const publishedAt = await writePublic(tx, actor, updated, patched, sourceVersion);
      await tx.update(events).set({ publishedVersion: sourceVersion, publishedAt }).where(eq(events.id, id));
      await recordRevision(tx, { eventId: id, version: updated.version, action: "publish", summary: input.canceled ? "Published cancellation" : "Published reinstatement", snapshot: patched, userId: actor.id });
      await logPublish(tx, actor, input.canceled ? "cancel" : "reinstate", reason, 1);
    }
  });
  return (await getEvent(id))!;
}

// ---------------------------------------------------------------------------
// Delete / undelete (soft delete with undo)
// ---------------------------------------------------------------------------
export async function deleteEvent(actor: SessionUser, id: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = await lockRow(tx, id);
    const [pub] = await tx.select().from(publicEvents).where(eq(publicEvents.eventId, id)).limit(1);
    if (pub) await tx.delete(publicEvents).where(eq(publicEvents.eventId, id));
    await tx
      .update(events)
      .set({ deletedAt: sql`now()`, deletedBy: actor.id, deletedPublicPayload: pub?.payload ?? null })
      .where(eq(events.id, id));
    await recordRevision(tx, { eventId: id, version: row.version, action: "delete", summary: pub ? "Deleted (and removed from the public calendar)" : "Deleted", snapshot: rowToDoc(row), userId: actor.id });
    if (pub) await logPublish(tx, actor, "delete", "", 1);
  });
}

export async function undeleteEvent(actor: SessionUser, id: string): Promise<EventRecord> {
  if (!isUuid(id)) throw notFound("Event not found.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(events).where(eq(events.id, id)).for("update").limit(1);
    if (!row) throw notFound("Event not found.");
    if (!row.deletedAt) return;
    const payload = row.deletedPublicPayload as PublicEvent | null;
    if (payload && row.publishedVersion != null) {
      await tx.insert(publicEvents).values({
        eventId: id,
        date: payload.date,
        startTime: payload.startTime,
        kind: payload.kind,
        status: payload.status,
        payload,
        sourceVersion: row.publishedVersion,
        publishedAt: payload.publishedAt,
        publishedBy: actor.id,
      });
    }
    await tx.update(events).set({ deletedAt: null, deletedBy: null, deletedPublicPayload: null }).where(eq(events.id, id));
    await recordRevision(tx, { eventId: id, version: row.version, action: "undelete", summary: payload ? "Restored from trash (public version restored)" : "Restored from trash", snapshot: rowToDoc(row), userId: actor.id });
    if (payload) await logPublish(tx, actor, "undelete", "", 1);
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

export async function restoreRevision(
  actor: SessionUser,
  eventId: string,
  revisionId: string,
  baseVersion?: number,
): Promise<EventRecord> {
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
// Duplication
// ---------------------------------------------------------------------------
export interface CopyOptions {
  copyCoaches?: boolean;
  copyNotes?: boolean;
}

/**
 * Prepare a copy of a document for a new date. Times are LOCAL wall-clock
 * times, so they are preserved exactly across daylight-saving changes.
 * Private notes and coach assignments are only copied when asked; completed
 * notes and cancellation never carry over.
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

export async function duplicateEvent(
  actor: SessionUser,
  id: string,
  input: { dates: string[] } & CopyOptions,
): Promise<string[]> {
  const dates = [...new Set(input.dates ?? [])];
  if (dates.length === 0 || dates.length > 60 || !dates.every(isISODate)) throw badRequest("Choose between 1 and 60 valid dates.");
  const source = await getEvent(id);
  if (!source) throw notFound("Event not found.");
  return getDb().transaction(async (tx) => {
    const ids: string[] = [];
    for (const date of dates.sort()) {
      const row = await createEventTx(tx, actor, prepareCopy(source, date, input), {
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
  input: { sourceWeekStart: string; targetWeekStart: string } & CopyOptions,
): Promise<string[]> {
  if (!isISODate(input.sourceWeekStart) || !isISODate(input.targetWeekStart)) throw badRequest("Invalid week.");
  const shift = diffDays(input.sourceWeekStart, input.targetWeekStart);
  if (shift === 0) throw badRequest("Choose a different target week.");
  const sources = await listEvents({ from: input.sourceWeekStart, to: addDays(input.sourceWeekStart, 6) });
  if (sources.length === 0) throw badRequest("There are no events in the source week.");
  return getDb().transaction(async (tx) => {
    const ids: string[] = [];
    for (const src of sources) {
      const row = await createEventTx(tx, actor, prepareCopy(src, addDays(src.date, shift), input), {
        action: "duplicate",
        summary: `Copied with week of ${input.sourceWeekStart}`,
      });
      ids.push(row.id);
    }
    return ids;
  });
}
