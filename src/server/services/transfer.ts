import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db";
import { events, locations, phases, seasons, templates, users } from "@/server/db/schema";
import { importFileSchema, IMPORT_FORMAT, IMPORT_VERSION, type ImportBlock, type ImportFile } from "@/lib/importFormat";
import { eventDocSchema, type Block, type EventDoc } from "@/lib/schemas";
import { sequenceBlocks } from "@/lib/sequencing";
import { analyzePractice, summarizeIssues } from "@/lib/timeline";
import { blockFromDrill, type LibraryDrill } from "@/lib/drills";
import { addMinutesToTime, minutesBetween } from "@/lib/dates";
import { newBlockId } from "@/lib/practice";
import { PLAN_KINDS, DEFAULT_PRACTICE_MINUTES } from "@/lib/constants";
import { WEAPONS, type Weapon } from "@/lib/weapons";
import type { SessionUser } from "@/server/auth/sessions";
import { createEventTx, isUuid, listAllEvents, saveEventTx } from "./events";
import { createDrillTx, createTemplateTx, listDrills, listSeasons, listTemplates, updateDrillTx } from "./library";
import { getSettings, listLocations } from "./settings";
import { audit } from "@/server/audit";

export interface ImportReport {
  dryRun: boolean;
  ok: boolean;
  counts: Record<"locations" | "drills" | "templates" | "seasons" | "events", { created: number; updated: number }>;
  warnings: string[];
  errors: string[];
  eventDates: string[];
}

class DryRunRollback extends Error {}

const emptyCounts = (): ImportReport["counts"] => ({
  locations: { created: 0, updated: 0 },
  drills: { created: 0, updated: 0 },
  templates: { created: 0, updated: 0 },
  seasons: { created: 0, updated: 0 },
  events: { created: 0, updated: 0 },
});

function drillInputFromImport(d: NonNullable<ImportFile["drills"]>[number]) {
  return {
    title: d.title,
    weapons: d.weapons ?? [],
    skills: d.skills ?? [],
    level: d.level ?? "all",
    durationMin: d.durationMin ?? null,
    equipment: d.equipment ?? [],
    tags: d.tags ?? [],
    category: d.category ?? "technical",
    coachNotes: d.coachNotes ?? "",
    details: {
      objective: d.objective ?? "",
      setup: d.setup ?? "",
      equipment: d.equipment ?? [],
      steps: d.steps ?? [],
      partnerRoles: d.partnerRoles ?? "",
      rotation: d.rotation ?? "",
      cues: d.cues ?? [],
      successCriteria: d.successCriteria ?? "",
      variations: { beginner: "", experienced: "", easier: "", harder: "", ...(d.variations ?? {}) },
      sets: d.sets ?? "",
      reps: d.reps ?? "",
      work: d.work ?? "",
      rest: d.rest ?? "",
      links: d.links ?? [],
    },
  };
}

/** Builds blocks: resolves drill keys into snapshots, applies overrides, auto-sequences missing starts. */
function buildBlocks(input: ImportBlock[] | undefined, drillsByKey: Map<string, LibraryDrill>, warnings: string[], where: string): Block[] {
  if (!input?.length) return [];
  const prepared = input.map((b) => {
    const scope: "shared" | "weapon" = b.lane === "shared" ? "shared" : "weapon";
    const weapons: Weapon[] = scope === "shared" ? [] : b.lanes ?? (b.lane && b.lane !== "shared" ? [b.lane as Weapon] : [...WEAPONS]);
    let base: Block | null = null;
    if (b.drill) {
      const drill = drillsByKey.get(b.drill);
      if (drill) base = blockFromDrill(drill, { scope, weapons, start: 0, duration: b.duration });
      else warnings.push(`${where}: drill “${b.drill}” was not found; the block keeps only the fields given in the file.`);
    }
    const duration = b.duration ?? base?.duration ?? 15;
    return { b, scope, weapons, duration, base, start: b.start ?? null };
  });
  const sequenced = sequenceBlocks(prepared.map((p) => ({ scope: p.scope, weapons: p.weapons, duration: p.duration, start: p.start, allowOverlap: p.b.allowOverlap })));
  return prepared.map((p, i) => {
    const b = p.b;
    const base = p.base;
    const pick = <T,>(override: T | undefined, fallback: T): T => (override !== undefined ? override : fallback);
    return {
      id: newBlockId(),
      scope: p.scope,
      weapons: p.weapons,
      start: sequenced[i].start,
      duration: p.duration,
      category: b.category ?? base?.category ?? "other",
      title: b.title ?? base?.title ?? "Untitled block",
      coach: b.coach ?? "",
      station: b.station ?? "",
      allowOverlap: b.allowOverlap ?? false,
      notes: b.notes ?? "",
      privateNotes: b.privateNotes ?? "",
      source: base?.source ?? null,
      objective: pick(b.objective, base?.objective ?? ""),
      setup: pick(b.setup, base?.setup ?? ""),
      equipment: pick(b.equipment, base?.equipment ?? []),
      steps: pick(b.steps, base?.steps ?? []),
      partnerRoles: pick(b.partnerRoles, base?.partnerRoles ?? ""),
      rotation: pick(b.rotation, base?.rotation ?? ""),
      cues: pick(b.cues, base?.cues ?? []),
      successCriteria: pick(b.successCriteria, base?.successCriteria ?? ""),
      variations: { beginner: "", experienced: "", easier: "", harder: "", ...(base?.variations ?? {}), ...(b.variations ?? {}) },
      sets: pick(b.sets, base?.sets ?? ""),
      reps: pick(b.reps, base?.reps ?? ""),
      work: pick(b.work, base?.work ?? ""),
      rest: pick(b.rest, base?.rest ?? ""),
      links: pick(b.links, base?.links ?? []),
    } satisfies Block;
  });
}

function resolveLocation(name: string | undefined, list: Array<{ id: string; name: string; shortName: string }>) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return list.find((l) => l.name.toLowerCase() === n || l.shortName.toLowerCase() === n) ?? null;
}

/** Validate and import a planning file. Dry runs execute inside a transaction that is rolled back. */
export async function runImport(actor: SessionUser, raw: unknown, opts: { dryRun: boolean }): Promise<ImportReport> {
  const parsed = importFileSchema.safeParse(raw);
  const report: ImportReport = { dryRun: opts.dryRun, ok: false, counts: emptyCounts(), warnings: [], errors: [], eventDates: [] };
  if (!parsed.success) {
    report.errors = parsed.error.issues.slice(0, 30).map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`);
    return report;
  }
  const file = parsed.data;
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await importTx(tx, actor, file, report);
      if (opts.dryRun) throw new DryRunRollback();
      await audit(tx, actor.id, "import.applied", { counts: report.counts });
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`Import failed and nothing was saved: ${message}`);
      return report;
    }
  }
  report.ok = report.errors.length === 0;
  report.eventDates = [...new Set(report.eventDates)].sort();
  return report;
}

async function importTx(tx: Tx, actor: SessionUser, file: ImportFile, report: ImportReport) {
  const settings = await getSettings(tx);

  // Locations
  const locs = await listLocations({ includeArchived: true }, tx);
  for (const l of file.locations ?? []) {
    const existing = resolveLocation(l.name, locs) ?? (l.shortName ? resolveLocation(l.shortName, locs) : null);
    if (existing) {
      await tx
        .update(locations)
        .set({ address: l.address ?? undefined, notes: l.notes ?? undefined, kind: l.kind ?? undefined, updatedAt: sql`now()` })
        .where(eq(locations.id, existing.id));
      report.counts.locations.updated++;
    } else {
      const [row] = await tx
        .insert(locations)
        .values({ name: l.name, shortName: l.shortName ?? l.name.slice(0, 40), address: l.address ?? "", kind: l.kind ?? "away", notes: l.notes ?? "" })
        .returning();
      locs.push(row);
      report.counts.locations.created++;
    }
  }

  // Drills (upsert by key)
  const drillsByKey = new Map<string, LibraryDrill>();
  const existingDrills = await listDrills({}, tx);
  for (const d of existingDrills) if (d.externalRef) drillsByKey.set(d.externalRef, d);
  for (const d of file.drills ?? []) {
    const input = drillInputFromImport(d);
    const existing = drillsByKey.get(d.key);
    if (existing) {
      const updated = await updateDrillTx(tx, actor, existing.id, null, input);
      drillsByKey.set(d.key, updated);
      report.counts.drills.updated++;
    } else {
      const created = await createDrillTx(tx, actor, input, { externalRef: d.key });
      drillsByKey.set(d.key, created);
      report.counts.drills.created++;
    }
  }

  // Templates (upsert by key)
  const existingTemplates = new Map((await listTemplates()).filter((t) => t.externalRef).map((t) => [t.externalRef!, t]));
  const templatesByKey = new Map<string, { doc: Partial<EventDoc>; name: string }>();
  for (const t of file.templates ?? []) {
    const blocks = buildBlocks(t.blocks, drillsByKey, report.warnings, `Template “${t.name}”`);
    const loc = resolveLocation(t.location, locs);
    const doc = {
      kind: "practice" as const,
      startTime: t.start ?? null,
      endTime: t.end ?? null,
      title: t.title ?? "",
      locationId: loc?.id ?? null,
      theme: t.theme ?? "",
      intensity: t.intensity ?? null,
      targetMinutes: t.targetMinutes ?? settings.defaultPracticeMinutes,
      objectives: t.objectives ?? [],
      announcement: t.announcement ?? "",
      equipment: t.equipment ?? [],
      weaponSummaries: { foil: "", epee: "", saber: "", ...(t.weaponSummaries ?? {}) },
      coachAssignments: { shared: "", foil: "", epee: "", saber: "", ...(t.coaches ?? {}) },
      levelNotes: { beginner: "", experienced: "", ...(t.levelNotes ?? {}) },
      blocks,
      privateNotes: t.privateNotes ?? "",
    };
    const input = { name: t.name, description: t.description ?? "", doc };
    const existing = existingTemplates.get(t.key);
    if (existing) {
      await tx
        .update(templates)
        .set({ name: t.name, description: t.description ?? "", doc: doc as never, version: existing.version + 1, updatedBy: actor.id, updatedAt: sql`now()` })
        .where(eq(templates.id, existing.id));
      report.counts.templates.updated++;
    } else {
      await createTemplateTx(tx, actor, input, { externalRef: t.key });
      report.counts.templates.created++;
    }
    templatesByKey.set(t.key, { doc, name: t.name });
  }

  // Seasons (upsert by name; phases replaced when provided)
  const existingSeasons = await listSeasons();
  for (const s of file.seasons ?? []) {
    if (s.endDate < s.startDate) {
      report.errors.push(`Season “${s.name}”: end date is before start date.`);
      continue;
    }
    let season = existingSeasons.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
    if (season) {
      await tx.update(seasons).set({ startDate: s.startDate, endDate: s.endDate, notes: s.notes ?? season.notes, updatedAt: sql`now()` }).where(eq(seasons.id, season.id));
      report.counts.seasons.updated++;
    } else {
      const [row] = await tx.insert(seasons).values({ name: s.name, startDate: s.startDate, endDate: s.endDate, notes: s.notes ?? "" }).returning();
      season = { ...row, phases: [] };
      report.counts.seasons.created++;
    }
    if (s.phases) {
      await tx.delete(phases).where(eq(phases.seasonId, season.id));
      for (const p of s.phases) {
        if (p.endDate < p.startDate) {
          report.errors.push(`Phase “${p.name}”: end date is before start date.`);
          continue;
        }
        await tx.insert(phases).values({ seasonId: season.id, name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus ?? "", color: p.color ?? "sky" });
      }
    }
  }

  // Events (upsert by key; existing published events get the import as unpublished draft changes)
  for (const [index, e] of (file.events ?? []).entries()) {
    const where = `Event ${index + 1} (${e.date}${e.title ? ` “${e.title}”` : ""})`;
    const tpl = e.template ? templatesByKey.get(e.template) ?? (await templateDocByKey(tx, e.template)) : null;
    if (e.template && !tpl) report.warnings.push(`${where}: template “${e.template}” was not found.`);
    const loc = resolveLocation(e.location, locs);
    if (e.location && !loc) report.warnings.push(`${where}: location “${e.location}” is not in the locations list; saved as venue text.`);
    const isPlan = PLAN_KINDS.includes(e.kind);
    const blocks = e.blocks ? buildBlocks(e.blocks, drillsByKey, report.warnings, where) : (tpl?.doc.blocks ?? []).map((b) => ({ ...b, id: newBlockId() }));
    const start = e.start !== undefined ? e.start : tpl?.doc.startTime ?? (isPlan ? settings.defaultPracticeStart : null);
    const target = e.targetMinutes ?? tpl?.doc.targetMinutes ?? (isPlan ? settings.defaultPracticeMinutes : DEFAULT_PRACTICE_MINUTES);
    const end = e.end !== undefined ? e.end : start && isPlan ? addMinutesToTime(start, target) : tpl?.doc.endTime ?? null;
    if (start && end && minutesBetween(start, end) <= 0) report.warnings.push(`${where}: end time is not after start time.`);
    const docInput = {
      kind: e.kind,
      date: e.date,
      startTime: start ?? null,
      endTime: end ?? null,
      title: e.title ?? tpl?.doc.title ?? "",
      confirmation: e.confirmation ?? "confirmed",
      status: e.status ?? "scheduled",
      cancelReason: e.cancelReason ?? "",
      locationId: loc?.id ?? (e.location ? null : tpl?.doc.locationId ?? (isPlan ? settings.defaultPracticeLocationId : null)),
      locationNote: e.location && !loc ? e.location : "",
      theme: e.theme ?? tpl?.doc.theme ?? "",
      intensity: e.intensity !== undefined ? e.intensity : tpl?.doc.intensity ?? null,
      targetMinutes: target,
      objectives: e.objectives ?? tpl?.doc.objectives ?? [],
      announcement: e.announcement ?? tpl?.doc.announcement ?? "",
      equipment: e.equipment ?? tpl?.doc.equipment ?? [],
      weaponSummaries: { foil: "", epee: "", saber: "", ...(tpl?.doc.weaponSummaries ?? {}), ...(e.weaponSummaries ?? {}) },
      coachAssignments: { shared: "", foil: "", epee: "", saber: "", ...(tpl?.doc.coachAssignments ?? {}), ...(e.coaches ?? {}) },
      levelNotes: { beginner: "", experienced: "", ...(tpl?.doc.levelNotes ?? {}), ...(e.levelNotes ?? {}) },
      meet: e.meet
        ? {
            opponent: e.meet.opponent ?? "",
            homeAway: e.meet.homeAway ?? null,
            reportTime: e.meet.reportTime ?? null,
            busDepart: e.meet.busDepart ?? null,
            busReturn: e.meet.busReturn ?? null,
            address: e.meet.address ?? "",
            details: e.meet.details ?? "",
          }
        : null,
      links: e.links ?? [],
      blocks,
      privateNotes: e.privateNotes ?? tpl?.doc.privateNotes ?? "",
      completedNotes: e.completedNotes ?? "",
    };
    const doc = eventDocSchema.safeParse(docInput);
    if (!doc.success) {
      report.errors.push(`${where}: ${doc.error.issues[0]?.path.join(".")}: ${doc.error.issues[0]?.message}`);
      continue;
    }
    if (isPlan && doc.data.blocks.length) {
      for (const issue of summarizeIssues(analyzePractice(doc.data.blocks, doc.data.targetMinutes)).slice(0, 4)) {
        report.warnings.push(`${where}: ${issue.message}${issue.weapons.length < 3 ? ` (${issue.weapons.join(", ")})` : ""}`);
      }
    }
    report.eventDates.push(e.date);
    const existing = e.key ? await findEventByKey(tx, e.key) : null;
    if (existing) {
      // Keep block ids stable when the plan content is unchanged so re-imports are no-ops.
      const { changed } = await saveEventTx(tx, actor, existing.id, null, reuseBlockIds(doc.data, existing), { action: "import", summary: "Updated by import" });
      if (changed.length) report.counts.events.updated++;
    } else {
      await createEventTx(tx, actor, doc.data, { action: "import", summary: "Created by import", externalRef: e.key && !isUuid(e.key) ? e.key : null });
      report.counts.events.created++;
    }
  }
}

/** Reuse existing block ids position-by-position so unchanged imports produce no diff. */
function reuseBlockIds(doc: EventDoc, existing: typeof events.$inferSelect): EventDoc {
  const prevBlocks = ((existing.content as { blocks?: Block[] }).blocks ?? []) as Block[];
  return {
    ...doc,
    blocks: doc.blocks.map((b, i) => {
      const prev = prevBlocks[i];
      if (!prev) return b;
      const sameSource = b.source && prev.source && b.source.drillId === prev.source.drillId && b.source.version === prev.source.version;
      return { ...b, id: prev.id, source: sameSource ? prev.source : b.source };
    }),
  };
}

async function findEventByKey(tx: Tx, key: string) {
  if (isUuid(key)) {
    const [row] = await tx.select().from(events).where(eq(events.id, key)).limit(1);
    if (row && !row.deletedAt) return row;
  }
  const [row] = await tx.select().from(events).where(eq(events.externalRef, key)).limit(1);
  return row && !row.deletedAt ? row : null;
}

async function templateDocByKey(tx: Tx, key: string) {
  const [row] = await tx.select().from(templates).where(eq(templates.externalRef, key)).limit(1);
  return row && !row.deletedAt ? { doc: row.doc as unknown as Partial<EventDoc>, name: row.name } : null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
/**
 * Full structured export in the import format (plus publication state,
 * locations, settings and the coach roster without credentials).
 * Contains PRIVATE notes — served only to administrators.
 */
export async function exportAll() {
  const db = getDb();
  const settings = await getSettings(db);
  const locs = await listLocations({ includeArchived: true });
  const allDrills = await listDrills({});
  const allTemplates = await listTemplates();
  const allSeasons = await listSeasons();
  const evs = await listAllEvents(db);
  const roster = await db.select({ name: users.name, email: users.email, role: users.role, disabledAt: users.disabledAt }).from(users).orderBy(asc(users.name));
  const locName = (id: string | null) => locs.find((l) => l.id === id)?.name;
  const drillKey = (id: string) => allDrills.find((d) => d.id === id)?.externalRef ?? id;

  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    exportedAt: new Date().toISOString(),
    team: { name: settings.teamName, shortName: settings.shortName, timezone: settings.timezone, publicIntro: settings.publicIntro, defaultPracticeMinutes: settings.defaultPracticeMinutes, defaultPracticeStart: settings.defaultPracticeStart },
    coaches: roster.map((u) => ({ name: u.name, email: u.email, role: u.role, active: !u.disabledAt })),
    locations: locs.map((l) => ({ name: l.name, shortName: l.shortName, address: l.address, kind: l.kind, notes: l.notes, archived: Boolean(l.archivedAt) })),
    drills: allDrills.map((d) => ({
      key: d.externalRef ?? d.id,
      title: d.title,
      weapons: d.weapons,
      category: d.category,
      skills: d.skills,
      level: d.level,
      durationMin: d.durationMin,
      tags: d.tags,
      coachNotes: d.coachNotes,
      ...d.details,
    })),
    templates: allTemplates.map((t) => ({
      key: t.externalRef ?? t.id,
      name: t.name,
      description: t.description,
      start: t.doc.startTime,
      end: t.doc.endTime,
      location: locName(t.doc.locationId),
      title: t.doc.title,
      theme: t.doc.theme,
      intensity: t.doc.intensity,
      targetMinutes: t.doc.targetMinutes,
      objectives: t.doc.objectives,
      announcement: t.doc.announcement,
      equipment: t.doc.equipment,
      weaponSummaries: t.doc.weaponSummaries,
      coaches: t.doc.coachAssignments,
      levelNotes: t.doc.levelNotes,
      privateNotes: t.doc.privateNotes,
      blocks: t.doc.blocks.map((b) => exportBlock(b, drillKey)),
    })),
    seasons: allSeasons.map((s) => ({
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      notes: s.notes,
      phases: s.phases.map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color })),
    })),
    events: evs.map((e) => ({
      key: e.externalRef ?? e.id,
      kind: e.kind,
      date: e.date,
      start: e.startTime,
      end: e.endTime,
      location: locName(e.locationId) ?? (e.locationNote || undefined),
      status: e.status,
      cancelReason: e.cancelReason,
      confirmation: e.confirmation,
      title: e.title,
      theme: e.theme,
      intensity: e.intensity,
      targetMinutes: e.targetMinutes,
      objectives: e.objectives,
      announcement: e.announcement,
      equipment: e.equipment,
      weaponSummaries: e.weaponSummaries,
      coaches: e.coachAssignments,
      levelNotes: e.levelNotes,
      meet: e.meet ?? undefined,
      links: e.links,
      privateNotes: e.privateNotes,
      completedNotes: e.completedNotes,
      blocks: e.blocks.map((b) => exportBlock(b, drillKey)),
      publication: e.publication,
      publishedAt: e.publishedAt,
      isDemo: e.isDemo,
    })),
  };
}

function exportBlock(b: Block, drillKey: (id: string) => string) {
  return {
    ...(b.scope === "shared" ? { lane: "shared" } : b.weapons.length === 1 ? { lane: b.weapons[0] } : { lanes: b.weapons }),
    start: b.start,
    duration: b.duration,
    ...(b.source ? { drill: drillKey(b.source.drillId) } : {}),
    title: b.title,
    category: b.category,
    coach: b.coach,
    station: b.station,
    allowOverlap: b.allowOverlap,
    notes: b.notes,
    privateNotes: b.privateNotes,
    objective: b.objective,
    setup: b.setup,
    equipment: b.equipment,
    steps: b.steps,
    partnerRoles: b.partnerRoles,
    rotation: b.rotation,
    cues: b.cues,
    successCriteria: b.successCriteria,
    variations: b.variations,
    sets: b.sets,
    reps: b.reps,
    work: b.work,
    rest: b.rest,
    links: b.links,
  };
}
