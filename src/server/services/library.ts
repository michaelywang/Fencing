import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { drills, events, phases, publicEvents, seasons, templates, tracks } from "@/server/db/schema";
import { drillInputSchema, eventDocSchema, phaseInputSchema, seasonInputSchema, templateInputSchema, type TemplateDoc } from "@/lib/schemas";
import type { LibraryDrill } from "@/lib/drills";
import { isISODate } from "@/lib/dates";
import { WEAPONS } from "@/lib/weapons";
import { AppError, ConflictError, badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { createEvent, getEvent, isUuid, type EventRecord } from "./events";
import { requireActiveTrack } from "./scope";
import { getSettings } from "./settings";
import { newBlockId } from "@/lib/practice";
import { audit } from "@/server/audit";

type DrillRow = typeof drills.$inferSelect;

function toDrill(row: DrillRow): LibraryDrill & { deletedAt: string | null; externalRef: string | null; trackId: string | null } {
  const parsed = drillInputSchema.safeParse({
    title: row.title,
    weapons: row.weapons,
    skills: row.skills,
    level: row.level,
    durationMin: row.durationMin,
    equipment: row.equipment,
    tags: row.tags,
    category: row.category,
    details: row.details,
    coachNotes: row.coachNotes,
  });
  const d = parsed.success ? parsed.data : (row as unknown as ReturnType<typeof drillInputSchema.parse>);
  return {
    id: row.id,
    version: row.version,
    title: d.title,
    weapons: d.weapons,
    skills: d.skills,
    level: d.level,
    durationMin: d.durationMin,
    equipment: d.equipment,
    tags: d.tags,
    category: d.category,
    details: d.details,
    coachNotes: d.coachNotes,
    updatedAt: row.updatedAt,
    isDemo: row.isDemo,
    deletedAt: row.deletedAt,
    externalRef: row.externalRef,
    trackId: row.trackId,
  };
}

/** Shared library rows plus (optionally) one track's local variants. Never another track's. */
function libraryScope(table: typeof drills | typeof templates, trackId: string | null | undefined): SQL {
  return trackId && isUuid(trackId) ? sql`(${table.trackId} IS NULL OR ${table.trackId} = ${trackId})` : isNull(table.trackId);
}

// ---------------------------------------------------------------------------
// Drill library
// ---------------------------------------------------------------------------
export interface DrillFilters {
  q?: string;
  weapon?: string;
  skill?: string;
  level?: string;
  maxDuration?: number;
  equipment?: string;
  tag?: string;
  deleted?: boolean;
  /** Include this track's track-only drills alongside the shared library. */
  trackId?: string | null;
}

export async function listDrills(filters: DrillFilters = {}, db: DbOrTx = getDb()) {
  const where: SQL[] = [filters.deleted ? isNotNull(drills.deletedAt) : isNull(drills.deletedAt), libraryScope(drills, filters.trackId)];
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    where.push(
      sql`(${drills.title} ILIKE ${like} OR ${drills.details}->>'objective' ILIKE ${like} OR array_to_string(${drills.tags}, ' ') ILIKE ${like} OR array_to_string(${drills.skills}, ' ') ILIKE ${like})`,
    );
  }
  if (filters.weapon && (WEAPONS as readonly string[]).includes(filters.weapon)) {
    where.push(sql`(cardinality(${drills.weapons}) = 0 OR ${filters.weapon} = ANY(${drills.weapons}))`);
  }
  if (filters.skill) where.push(sql`${filters.skill} = ANY(${drills.skills})`);
  if (filters.equipment) where.push(sql`${filters.equipment} = ANY(${drills.equipment})`);
  if (filters.tag) where.push(sql`${filters.tag} = ANY(${drills.tags})`);
  if (filters.level && ["beginner", "intermediate", "experienced"].includes(filters.level)) {
    where.push(sql`(${drills.level} = ${filters.level} OR ${drills.level} = 'all')`);
  }
  if (filters.maxDuration && Number.isFinite(filters.maxDuration)) {
    where.push(sql`(${drills.durationMin} IS NULL OR ${drills.durationMin} <= ${filters.maxDuration})`);
  }
  const rows = await db.select().from(drills).where(and(...where)).orderBy(asc(drills.title)).limit(500);
  return rows.map(toDrill);
}

export async function drillFacets() {
  const db = getDb();
  const result = await db.execute<{ skills: string[] | null; equipment: string[] | null; tags: string[] | null }>(sql`
    SELECT
      (SELECT array_agg(DISTINCT s ORDER BY s) FROM drills, unnest(skills) s WHERE deleted_at IS NULL) AS skills,
      (SELECT array_agg(DISTINCT e ORDER BY e) FROM drills, unnest(equipment) e WHERE deleted_at IS NULL) AS equipment,
      (SELECT array_agg(DISTINCT t ORDER BY t) FROM drills, unnest(tags) t WHERE deleted_at IS NULL) AS tags
  `);
  const row = result.rows[0] ?? { skills: [], equipment: [], tags: [] };
  return { skills: row.skills ?? [], equipment: row.equipment ?? [], tags: row.tags ?? [] };
}

export async function getDrill(id: string, db: DbOrTx = getDb()) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(drills).where(eq(drills.id, id)).limit(1);
  return row ? toDrill(row) : null;
}

export async function createDrillTx(
  tx: DbOrTx,
  actor: SessionUser | null,
  input: unknown,
  opts: { externalRef?: string | null; isDemo?: boolean; trackId?: string | null } = {},
) {
  const data = drillInputSchema.parse(input);
  const [row] = await tx
    .insert(drills)
    .values({ ...data, externalRef: opts.externalRef ?? null, isDemo: opts.isDemo ?? false, trackId: opts.trackId ?? null, createdBy: actor?.id ?? null, updatedBy: actor?.id ?? null })
    .returning();
  return toDrill(row);
}

/** `trackId` set = a track-only drill (experiments never touch the shared library). */
export async function createDrill(actor: SessionUser, input: unknown, opts: { trackId?: string | null } = {}) {
  if (opts.trackId) await requireActiveTrack(opts.trackId);
  return createDrillTx(getDb(), actor, input, { trackId: opts.trackId ?? null });
}

/** Explicit, separately reviewed step: make a track-only drill part of the shared library. */
export async function promoteDrill(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("Drill not found.");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(drills).where(eq(drills.id, id)).for("update").limit(1);
    if (!row || row.deletedAt) throw notFound("Drill not found.");
    if (!row.trackId) return toDrill(row);
    if (row.externalRef) {
      const [dup] = await tx.select({ id: drills.id }).from(drills).where(and(isNull(drills.trackId), eq(drills.externalRef, row.externalRef), isNull(drills.deletedAt))).limit(1);
      if (dup) throw new AppError(409, "key_taken", `The shared library already has a drill with the import key “${row.externalRef}”. Update that drill instead, or rename this key.`);
    }
    const [updated] = await tx.update(drills).set({ trackId: null, version: row.version + 1, updatedBy: actor.id, updatedAt: sql`now()` }).where(eq(drills.id, id)).returning();
    await audit(tx, actor.id, "drill.promoted", { id, fromTrack: row.trackId });
    return toDrill(updated);
  });
}

export async function updateDrillTx(tx: Tx, actor: SessionUser | null, id: string, baseVersion: number | null, input: unknown) {
  const data = drillInputSchema.parse(input);
  const [row] = await tx.select().from(drills).where(eq(drills.id, id)).for("update").limit(1);
  if (!row || row.deletedAt) throw notFound("Drill not found.");
  if (baseVersion !== null && row.version !== baseVersion) throw new ConflictError({ current: toDrill(row) });
  const current = toDrill(row);
  const same =
    JSON.stringify({ ...data }) ===
    JSON.stringify({
      title: current.title,
      weapons: current.weapons,
      skills: current.skills,
      level: current.level,
      durationMin: current.durationMin,
      equipment: current.equipment,
      tags: current.tags,
      category: current.category,
      details: current.details,
      coachNotes: current.coachNotes,
    });
  if (same) return current; // no-op save keeps the version (and existing snapshots) unchanged
  const [updated] = await tx
    .update(drills)
    .set({ ...data, version: row.version + 1, updatedBy: actor?.id ?? null, updatedAt: sql`now()` })
    .where(eq(drills.id, id))
    .returning();
  return toDrill(updated);
}

export async function updateDrill(actor: SessionUser, id: string, input: { baseVersion: number; drill: unknown }) {
  if (!isUuid(id)) throw notFound("Drill not found.");
  return getDb().transaction((tx) => updateDrillTx(tx, actor, id, input.baseVersion, input.drill));
}

async function assertKeyFree(table: typeof drills | typeof templates, id: string) {
  const [row] = await getDb().select().from(table).where(eq(table.id, id)).limit(1);
  if (!row || !row.externalRef) return;
  const [dup] = await getDb()
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.externalRef, row.externalRef), isNull(table.deletedAt), row.trackId ? eq(table.trackId, row.trackId) : isNull(table.trackId)))
    .limit(1);
  if (dup && dup.id !== id) {
    throw new AppError(409, "restore_conflict", `An active item already uses the import key “${row.externalRef}”. Restore it from Trash to choose “keep both” or “replace”.`);
  }
}

export async function setDrillDeleted(actor: SessionUser, id: string, deleted: boolean) {
  if (!isUuid(id)) throw notFound("Drill not found.");
  if (!deleted) await assertKeyFree(drills, id);
  const db = getDb();
  const [row] = await db
    .update(drills)
    .set({ deletedAt: deleted ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(drills.id, id))
    .returning({ id: drills.id });
  if (!row) throw notFound("Drill not found.");
  await audit(db, actor.id, deleted ? "drill.deleted" : "drill.restored", { id });
}

// ---------------------------------------------------------------------------
// Practice templates
// ---------------------------------------------------------------------------
type TemplateRow = typeof templates.$inferSelect;
const toTemplate = (row: TemplateRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  doc: templateInputSchema.shape.doc.parse(row.doc),
  version: row.version,
  isDemo: row.isDemo,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
  externalRef: row.externalRef,
  trackId: row.trackId,
});
export type Template = ReturnType<typeof toTemplate>;

export async function listTemplates(opts: { deleted?: boolean; trackId?: string | null } = {}) {
  const rows = await getDb()
    .select()
    .from(templates)
    .where(and(opts.deleted ? isNotNull(templates.deletedAt) : isNull(templates.deletedAt), libraryScope(templates, opts.trackId)))
    .orderBy(asc(templates.name));
  return rows.map(toTemplate);
}

export async function getTemplate(id: string) {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select().from(templates).where(eq(templates.id, id)).limit(1);
  return row ? toTemplate(row) : null;
}

export async function createTemplateTx(
  tx: DbOrTx,
  actor: SessionUser | null,
  input: unknown,
  opts: { externalRef?: string | null; isDemo?: boolean; trackId?: string | null } = {},
) {
  const data = templateInputSchema.parse(input);
  const [row] = await tx
    .insert(templates)
    .values({
      name: data.name,
      description: data.description,
      doc: data.doc,
      externalRef: opts.externalRef ?? null,
      isDemo: opts.isDemo ?? false,
      trackId: opts.trackId ?? null,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    })
    .returning();
  return toTemplate(row);
}

export async function createTemplate(actor: SessionUser, input: unknown, opts: { trackId?: string | null } = {}) {
  if (opts.trackId) await requireActiveTrack(opts.trackId);
  return createTemplateTx(getDb(), actor, input, { trackId: opts.trackId ?? null });
}

export async function promoteTemplate(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("Template not found.");
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(templates).where(eq(templates.id, id)).for("update").limit(1);
    if (!row || row.deletedAt) throw notFound("Template not found.");
    if (!row.trackId) return toTemplate(row);
    if (row.externalRef) {
      const [dup] = await tx.select({ id: templates.id }).from(templates).where(and(isNull(templates.trackId), eq(templates.externalRef, row.externalRef), isNull(templates.deletedAt))).limit(1);
      if (dup) throw new AppError(409, "key_taken", `A shared template already uses the import key “${row.externalRef}”.`);
    }
    const [updated] = await tx.update(templates).set({ trackId: null, version: row.version + 1, updatedBy: actor.id, updatedAt: sql`now()` }).where(eq(templates.id, id)).returning();
    await audit(tx, actor.id, "template.promoted", { id, fromTrack: row.trackId });
    return toTemplate(updated);
  });
}

/** Save an existing practice as a template. Private notes are excluded unless requested. */
export async function createTemplateFromEvent(
  actor: SessionUser,
  eventId: string,
  input: { name: string; description?: string; includeNotes?: boolean; includeCoaches?: boolean; trackOnly?: boolean },
) {
  const ev = await getEvent(eventId);
  if (!ev) throw notFound("Event not found.");
  const doc: TemplateDoc = {
    kind: ev.kind,
    startTime: ev.startTime,
    endTime: ev.endTime,
    title: ev.title,
    locationId: ev.locationId,
    theme: ev.theme,
    intensity: ev.intensity,
    targetMinutes: ev.targetMinutes,
    objectives: ev.objectives,
    announcement: ev.announcement,
    equipment: ev.equipment,
    weaponSummaries: ev.weaponSummaries,
    coachAssignments: input.includeCoaches ? ev.coachAssignments : { shared: "", foil: "", epee: "", saber: "" },
    levelNotes: ev.levelNotes,
    blocks: ev.blocks.map((b) => ({
      ...b,
      coach: input.includeCoaches ? b.coach : "",
      privateNotes: input.includeNotes ? b.privateNotes : "",
    })),
    privateNotes: input.includeNotes ? ev.privateNotes : "",
  };
  return createTemplate(actor, { name: input.name, description: input.description ?? "", doc }, { trackId: input.trackOnly ? ev.trackId : null });
}

export async function updateTemplate(actor: SessionUser, id: string, input: { baseVersion: number; template: unknown }) {
  if (!isUuid(id)) throw notFound("Template not found.");
  const data = templateInputSchema.parse(input.template);
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(templates).where(eq(templates.id, id)).for("update").limit(1);
    if (!row || row.deletedAt) throw notFound("Template not found.");
    if (row.version !== input.baseVersion) throw new ConflictError({ current: toTemplate(row) });
    const [updated] = await tx
      .update(templates)
      .set({ name: data.name, description: data.description, doc: data.doc, version: row.version + 1, updatedBy: actor.id, updatedAt: sql`now()` })
      .where(eq(templates.id, id))
      .returning();
    return toTemplate(updated);
  });
}

export async function setTemplateDeleted(actor: SessionUser, id: string, deleted: boolean) {
  if (!isUuid(id)) throw notFound("Template not found.");
  if (!deleted) await assertKeyFree(templates, id);
  const [row] = await getDb()
    .update(templates)
    .set({ deletedAt: deleted ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(templates.id, id))
    .returning({ id: templates.id });
  if (!row) throw notFound("Template not found.");
}

/** Create a new DRAFT practice on `date` in the given track from a template (blocks get fresh ids). */
export async function applyTemplate(actor: SessionUser, id: string, input: { trackId: string; date: string; startTime?: string | null }): Promise<EventRecord> {
  if (!isISODate(input.date)) throw badRequest("Choose a valid date.");
  const t = await getTemplate(id);
  if (!t || t.deletedAt) throw notFound("Template not found.");
  if (t.trackId && t.trackId !== input.trackId) throw badRequest("That template belongs to another track.");
  const settings = await getSettings();
  const doc = eventDocSchema.parse({
    ...t.doc,
    date: input.date,
    startTime: input.startTime ?? t.doc.startTime ?? settings.defaultPracticeStart,
    endTime: t.doc.endTime,
    locationId: t.doc.locationId ?? settings.defaultPracticeLocationId,
    blocks: t.doc.blocks.map((b) => ({ ...b, id: newBlockId() })),
  });
  return createEvent(actor, doc, { trackId: input.trackId, action: "template", summary: `Created from template “${t.name}”` });
}

// ---------------------------------------------------------------------------
// Seasons (workspaces) & track phases
// ---------------------------------------------------------------------------
type PhaseRow = typeof phases.$inferSelect;

/** Seasons with the given track's (private) phases. Published phases are read from public_phases. */
export async function listSeasons(opts: { trackId?: string | null } = {}) {
  const db = getDb();
  const s = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const p: PhaseRow[] = opts.trackId && isUuid(opts.trackId)
    ? await db.select().from(phases).where(and(eq(phases.trackId, opts.trackId), isNull(phases.deletedAt))).orderBy(asc(phases.startDate))
    : [];
  return s.map((season) => ({ ...season, phases: p.filter((x) => x.seasonId === season.id) }));
}

/** A new season starts with one empty track, "Track A". */
export async function createSeason(actor: SessionUser | null, input: unknown, opts: { isDemo?: boolean; tx?: DbOrTx } = {}) {
  const data = seasonInputSchema.parse(input);
  const run = async (tx: DbOrTx) => {
    const [row] = await tx.insert(seasons).values({ ...data, isDemo: opts.isDemo ?? false }).returning();
    await tx.insert(tracks).values({ seasonId: row.id, name: "Track A", origin: "empty", isDemo: opts.isDemo ?? false, createdBy: actor?.id ?? null });
    return row;
  };
  return opts.tx ? run(opts.tx) : getDb().transaction(run);
}

export async function updateSeason(actor: SessionUser, id: string, input: unknown) {
  if (!isUuid(id)) throw notFound("Season not found.");
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = seasonInputSchema.parse(input);
  const patch: Partial<typeof seasons.$inferInsert> = { ...data, updatedAt: sql`now()` as unknown as string };
  if (typeof raw.publicVisible === "boolean") patch.publicVisible = raw.publicVisible;
  const [row] = await getDb().update(seasons).set(patch).where(eq(seasons.id, id)).returning();
  if (!row) throw notFound("Season not found.");
  return row;
}

/** Only an EMPTY season can be deleted (no events in any track or Trash, nothing live). */
export async function deleteSeason(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("Season not found.");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, id)).for("update").limit(1);
    if (!s) throw notFound("Season not found.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(events).innerJoin(tracks, eq(tracks.id, events.trackId)).where(eq(tracks.seasonId, id));
    const [{ m }] = await tx.select({ m: sql<number>`count(*)::int` }).from(publicEvents).where(eq(publicEvents.seasonId, id));
    if (n > 0 || m > 0) {
      throw new AppError(409, "season_not_empty", `This season still has ${n} planned event${n === 1 ? "" : "s"} (including Trash) and ${m} published. Clear it and empty its Trash before deleting the season.`);
    }
    await tx.delete(seasons).where(eq(seasons.id, id));
    await audit(tx, actor.id, "season.deleted", { id, name: s.name });
  });
}

const trackPhaseInput = (input: unknown) => {
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = phaseInputSchema.parse(input);
  return { data, trackId: typeof raw.trackId === "string" ? raw.trackId : null };
};

/** Phases are PLAN-SPECIFIC: they belong to one track and are published separately. */
export async function createPhase(actor: SessionUser | null, input: unknown, opts: { isDemo?: boolean; tx?: DbOrTx } = {}) {
  const { data, trackId } = trackPhaseInput(input);
  const db = opts.tx ?? getDb();
  const track = await requireActiveTrack(trackId, db);
  if (track.seasonId !== data.seasonId) throw badRequest("That track belongs to another season.");
  const [row] = await db.insert(phases).values({ ...data, trackId: track.id, isDemo: opts.isDemo ?? false }).returning();
  return row;
}

export async function updatePhase(actor: SessionUser, id: string, input: unknown) {
  if (!isUuid(id)) throw notFound("Phase not found.");
  const data = phaseInputSchema.parse(input);
  const [cur] = await getDb().select().from(phases).where(eq(phases.id, id)).limit(1);
  if (!cur || cur.deletedAt) throw notFound("Phase not found.");
  await requireActiveTrack(cur.trackId);
  const [row] = await getDb()
    .update(phases)
    .set({ name: data.name, startDate: data.startDate, endDate: data.endDate, focus: data.focus, color: data.color, updatedAt: sql`now()` })
    .where(eq(phases.id, id))
    .returning();
  return row;
}

/** Moves the phase to Trash (restorable). */
export async function deletePhase(actor: SessionUser, id: string) {
  if (!isUuid(id)) throw notFound("Phase not found.");
  const [row] = await getDb().update(phases).set({ deletedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(phases.id, id), isNull(phases.deletedAt))).returning({ id: phases.id });
  if (!row) throw notFound("Phase not found.");
}

/** A track's phases overlapping a range (coach planning views). */
export async function listTrackPhasesInRange(trackId: string, from: string, to: string) {
  if (!isUuid(trackId)) return [];
  const rows = await getDb()
    .select()
    .from(phases)
    .where(and(eq(phases.trackId, trackId), isNull(phases.deletedAt), sql`${phases.startDate} <= ${to}`, sql`${phases.endDate} >= ${from}`))
    .orderBy(asc(phases.startDate));
  return rows.map((ph) => ({ id: ph.id, seasonId: ph.seasonId, name: ph.name, startDate: ph.startDate, endDate: ph.endDate, focus: ph.focus, color: ph.color }));
}
