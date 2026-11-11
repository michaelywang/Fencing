import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db";
import { events, locations, logicalEvents, phases, seasons, templates, tracks, users } from "@/server/db/schema";
import { importFileSchema, IMPORT_FORMAT, IMPORT_VERSION, PLANNING_EXPORT_VERSION, type ImportBlock, type ImportFile } from "@/lib/importFormat";
import { drillInputSchema, eventDocSchema, templateInputSchema, type Block, type EventDoc } from "@/lib/schemas";
import { sequenceBlocks } from "@/lib/sequencing";
import { analyzePractice, summarizeIssues } from "@/lib/timeline";
import { blockFromDrill, type LibraryDrill } from "@/lib/drills";
import { addMinutesToTime, minutesBetween } from "@/lib/dates";
import { newBlockId } from "@/lib/practice";
import { PLAN_KINDS, DEFAULT_PRACTICE_MINUTES } from "@/lib/constants";
import { WEAPONS, type Weapon } from "@/lib/weapons";
import type { SessionUser } from "@/server/auth/sessions";
import { createEventTx, isUuid, listTrackEvents, saveEventTx } from "./events";
import { createDrillTx, createTemplateTx, listDrills, listTemplates, updateDrillTx } from "./library";
import { getSettings, listLocations } from "./settings";
import { MAX_BULK_ROWS, listWorkspaces, lockTrack, pickDefaultSeason } from "./scope";
import { audit } from "@/server/audit";
import { canonicalJson } from "@/server/live/hash";
import { todayInTimeZone } from "@/lib/dates";

export type ImportCountKey = "locations" | "drills" | "templates" | "seasons" | "phases" | "events";

export interface ImportReport {
  dryRun: boolean;
  ok: boolean;
  /** Where the plan goes. Imports never change the public schedule. */
  target: { seasonId: string; seasonName: string; trackId: string; trackName: string } | null;
  /** true = the coach explicitly chose to create/update SHARED drills, templates, venues and season dates. */
  sharedMode: boolean;
  counts: Record<ImportCountKey, { created: number; updated: number; unchanged: number }>;
  /** Shared-resource changes: applied (shared mode) or proposed and NOT applied (track mode). */
  sharedChanges: string[];
  identity: { matchedInTrack: number; sharedWithOtherTracks: number; reusedFromTrash: number; brandNew: number };
  conflicts: string[];
  warnings: string[];
  errors: string[];
  eventDates: string[];
}

export interface ImportOptions {
  dryRun: boolean;
  trackId: string;
  /** Explicit opt-in to change the shared library/locations/season (separately reviewed in the dry run). */
  updateShared?: boolean;
}

class ImportRollback extends Error {}

const emptyCounts = (): ImportReport["counts"] => ({
  locations: { created: 0, updated: 0, unchanged: 0 },
  drills: { created: 0, updated: 0, unchanged: 0 },
  templates: { created: 0, updated: 0, unchanged: 0 },
  seasons: { created: 0, updated: 0, unchanged: 0 },
  phases: { created: 0, updated: 0, unchanged: 0 },
  events: { created: 0, updated: 0, unchanged: 0 },
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

/**
 * Validate and import a planning file INTO ONE TRACK. Dry runs execute inside a
 * transaction that is rolled back. If any error is reported, nothing is saved
 * (the whole transaction rolls back) — a partial plan is never committed.
 */
export async function runImport(actor: SessionUser, raw: unknown, opts: ImportOptions): Promise<ImportReport> {
  const parsed = importFileSchema.safeParse(raw);
  const report: ImportReport = {
    dryRun: opts.dryRun,
    ok: false,
    target: null,
    sharedMode: !!opts.updateShared,
    counts: emptyCounts(),
    sharedChanges: [],
    identity: { matchedInTrack: 0, sharedWithOtherTracks: 0, reusedFromTrash: 0, brandNew: 0 },
    conflicts: [],
    warnings: [],
    errors: [],
    eventDates: [],
  };
  if (!parsed.success) {
    report.errors = parsed.error.issues.slice(0, 30).map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`);
    return report;
  }
  const file = parsed.data;
  if ((file.events?.length ?? 0) > MAX_BULK_ROWS) {
    report.errors.push(`This file has ${file.events!.length} events; at most ${MAX_BULK_ROWS} can be imported in one step. Split it by date range.`);
    return report;
  }
  if (!isUuid(opts.trackId)) {
    report.errors.push("Choose the planning track to import into.");
    return report;
  }
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await importTx(tx, actor, file, report, opts);
      if (report.errors.length) throw new ImportRollback();
      if (opts.dryRun) throw new ImportRollback();
      await audit(tx, actor.id, "import.applied", { trackId: opts.trackId, sharedMode: report.sharedMode, counts: report.counts });
    });
  } catch (err) {
    if (!(err instanceof ImportRollback)) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`Import failed and nothing was saved: ${message}`);
      return report;
    }
  }
  if (report.errors.length && !opts.dryRun) report.errors.push("Nothing was saved because of the errors above.");
  report.ok = report.errors.length === 0;
  report.eventDates = [...new Set(report.eventDates)].sort();
  return report;
}

const drillEq = (d: LibraryDrill, input: ReturnType<typeof drillInputFromImport>) => {
  const parsed = drillInputSchema.parse(input);
  return (
    canonicalJson(parsed) ===
    canonicalJson({ title: d.title, weapons: d.weapons, skills: d.skills, level: d.level, durationMin: d.durationMin, equipment: d.equipment, tags: d.tags, category: d.category, details: d.details, coachNotes: d.coachNotes })
  );
};

async function importTx(tx: Tx, actor: SessionUser, file: ImportFile, report: ImportReport, opts: ImportOptions) {
  const track = await lockTrack(tx, opts.trackId);
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, track.seasonId)).limit(1);
  report.target = { seasonId: season.id, seasonName: season.name, trackId: track.id, trackName: track.name };
  const shared = !!opts.updateShared;
  const settings = await getSettings(tx);

  // ---- Locations (shared). Reused when they match; changes only with the explicit shared choice.
  const locs = await listLocations({ includeArchived: true }, tx);
  for (const l of file.locations ?? []) {
    const existing = resolveLocation(l.name, locs) ?? (l.shortName ? resolveLocation(l.shortName, locs) : null);
    if (existing) {
      const full = locs.find((x) => x.id === existing.id)!;
      const differs = (l.address !== undefined && l.address !== full.address) || (l.notes !== undefined && l.notes !== full.notes) || (l.kind !== undefined && l.kind !== full.kind);
      if (!differs) {
        report.counts.locations.unchanged++;
      } else if (shared) {
        await tx
          .update(locations)
          .set({ address: l.address ?? undefined, notes: l.notes ?? undefined, kind: l.kind ?? undefined, updatedAt: sql`now()` })
          .where(eq(locations.id, existing.id));
        report.counts.locations.updated++;
        report.sharedChanges.push(`Updated shared location “${full.name}”.`);
      } else {
        report.counts.locations.unchanged++;
        report.sharedChanges.push(`Proposed (not applied): update shared location “${full.name}” (address/notes/type differ).`);
      }
    } else if (shared) {
      const [row] = await tx
        .insert(locations)
        .values({ name: l.name, shortName: l.shortName ?? l.name.slice(0, 40), address: l.address ?? "", kind: l.kind ?? "away", notes: l.notes ?? "" })
        .returning();
      locs.push(row);
      report.counts.locations.created++;
      report.sharedChanges.push(`Created shared location “${l.name}”.`);
    } else {
      report.sharedChanges.push(`Proposed (not applied): create shared location “${l.name}”. Events use it as venue text instead.`);
    }
  }

  // ---- Drills: track-only variants by default; identical shared drills are reused unchanged.
  const drillsByKey = new Map<string, LibraryDrill>();
  const visible = await listDrills({ trackId: track.id }, tx);
  const sharedByKey = new Map(visible.filter((d) => !d.trackId && d.externalRef).map((d) => [d.externalRef!, d]));
  const localByKey = new Map(visible.filter((d) => d.trackId === track.id && d.externalRef).map((d) => [d.externalRef!, d]));
  for (const d of visible) if (d.externalRef && !drillsByKey.has(d.externalRef)) drillsByKey.set(d.externalRef, d);
  for (const d of localByKey.values()) drillsByKey.set(d.externalRef!, d); // local wins over shared
  const seenDrillKeys = new Set<string>();
  for (const d of file.drills ?? []) {
    if (seenDrillKeys.has(d.key)) {
      report.errors.push(`Drill key “${d.key}” appears more than once in the file.`);
      continue;
    }
    seenDrillKeys.add(d.key);
    const input = drillInputFromImport(d);
    const local = localByKey.get(d.key);
    const sharedDrill = sharedByKey.get(d.key);
    if (shared && !local) {
      if (sharedDrill) {
        if (drillEq(sharedDrill, input)) report.counts.drills.unchanged++;
        else {
          const updated = await updateDrillTx(tx, actor, sharedDrill.id, null, input);
          drillsByKey.set(d.key, updated);
          report.counts.drills.updated++;
          report.sharedChanges.push(`Updated shared drill “${d.title}” (${d.key}).`);
        }
      } else {
        drillsByKey.set(d.key, await createDrillTx(tx, actor, input, { externalRef: d.key }));
        report.counts.drills.created++;
        report.sharedChanges.push(`Added shared drill “${d.title}” (${d.key}).`);
      }
      continue;
    }
    if (local) {
      if (drillEq(local, input)) report.counts.drills.unchanged++;
      else {
        drillsByKey.set(d.key, await updateDrillTx(tx, actor, local.id, null, input));
        report.counts.drills.updated++;
      }
    } else if (sharedDrill && drillEq(sharedDrill, input)) {
      drillsByKey.set(d.key, sharedDrill); // identical shared drill: reuse, unchanged
      report.counts.drills.unchanged++;
    } else {
      drillsByKey.set(d.key, await createDrillTx(tx, actor, input, { externalRef: d.key, trackId: track.id }));
      report.counts.drills.created++;
      if (sharedDrill) report.sharedChanges.push(`Proposed (not applied): update shared drill “${sharedDrill.title}” (${d.key}). This track uses its own copy instead.`);
    }
  }

  // ---- Templates: same rule as drills.
  const visibleTemplates = await listTemplatesTx(tx, track.id);
  const tShared = new Map(visibleTemplates.filter((t) => !t.trackId && t.externalRef).map((t) => [t.externalRef!, t]));
  const tLocal = new Map(visibleTemplates.filter((t) => t.trackId === track.id && t.externalRef).map((t) => [t.externalRef!, t]));
  const templatesByKey = new Map<string, { doc: Partial<EventDoc>; name: string }>();
  for (const t of visibleTemplates) if (t.externalRef) templatesByKey.set(t.externalRef, { doc: t.doc as Partial<EventDoc>, name: t.name });
  for (const t of tLocal.values()) templatesByKey.set(t.externalRef!, { doc: t.doc as Partial<EventDoc>, name: t.name });
  for (const t of file.templates ?? []) {
    const blocks = buildBlocks(t.blocks, drillsByKey, report.warnings, `Template “${t.name}”`);
    const loc = resolveLocation(t.location, locs);
    const docInput = {
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
    const local = tLocal.get(t.key);
    const sharedT = tShared.get(t.key);
    const target = shared && !local ? sharedT : local;
    const withIds = (prev: { doc: { blocks: Block[] } } | undefined) => ({ ...docInput, blocks: reuseIds(docInput.blocks, prev?.doc.blocks ?? []) });
    const sameAs = (prev: { name: string; description: string; doc: unknown } | undefined) =>
      !!prev && prev.name === t.name && prev.description === (t.description ?? "") && canonicalJson(templateInputSchema.shape.doc.parse(withIds(prev as never))) === canonicalJson(prev.doc);
    if (target) {
      const doc = withIds(target);
      if (sameAs(target)) report.counts.templates.unchanged++;
      else {
        await tx
          .update(templates)
          .set({ name: t.name, description: t.description ?? "", doc: templateInputSchema.shape.doc.parse(doc), version: target.version + 1, updatedBy: actor.id, updatedAt: sql`now()` })
          .where(eq(templates.id, target.id));
        report.counts.templates.updated++;
        if (!target.trackId) report.sharedChanges.push(`Updated shared template “${t.name}” (${t.key}).`);
      }
      templatesByKey.set(t.key, { doc, name: t.name });
    } else if (!shared && sharedT && sameAs(sharedT)) {
      report.counts.templates.unchanged++;
      templatesByKey.set(t.key, { doc: sharedT.doc as Partial<EventDoc>, name: sharedT.name });
    } else {
      await createTemplateTx(tx, actor, { name: t.name, description: t.description ?? "", doc: docInput }, { externalRef: t.key, trackId: shared ? null : track.id });
      report.counts.templates.created++;
      if (shared) report.sharedChanges.push(`Added shared template “${t.name}” (${t.key}).`);
      else if (sharedT) report.sharedChanges.push(`Proposed (not applied): update shared template “${sharedT.name}” (${t.key}). This track uses its own copy instead.`);
      templatesByKey.set(t.key, { doc: docInput, name: t.name });
    }
  }

  // ---- Season display data (shared) and this track's phases (private to the track).
  const fileSeasons = file.seasons ?? [];
  for (const s of fileSeasons) {
    if (s.endDate < s.startDate) {
      report.errors.push(`Season “${s.name}”: end date is before start date.`);
      continue;
    }
    const isTarget = s.name.trim().toLowerCase() === season.name.trim().toLowerCase() || fileSeasons.length === 1;
    if (!isTarget) {
      report.warnings.push(`Season “${s.name}” was skipped: this import goes into “${season.name}”. Import that season's plan into one of its own tracks.`);
      continue;
    }
    const differs = s.startDate !== season.startDate || s.endDate !== season.endDate || (s.notes !== undefined && s.notes !== season.notes) || s.name !== season.name;
    if (!differs) report.counts.seasons.unchanged++;
    else if (shared) {
      await tx.update(seasons).set({ name: s.name, startDate: s.startDate, endDate: s.endDate, notes: s.notes ?? season.notes, updatedAt: sql`now()` }).where(eq(seasons.id, season.id));
      report.counts.seasons.updated++;
      report.sharedChanges.push(`Updated season “${season.name}” name/dates to “${s.name}” ${s.startDate} → ${s.endDate}.`);
    } else {
      report.counts.seasons.unchanged++;
      report.sharedChanges.push(`Proposed (not applied): change season “${season.name}” to “${s.name}” ${s.startDate} → ${s.endDate}.`);
    }
    if (s.phases) {
      const bad = s.phases.filter((p) => p.endDate < p.startDate);
      for (const p of bad) report.errors.push(`Phase “${p.name}”: end date is before start date.`);
      const next = s.phases.filter((p) => p.endDate >= p.startDate).map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus ?? "", color: p.color ?? "sky" }));
      const cur = await tx.select().from(phases).where(and(eq(phases.trackId, track.id), isNull(phases.deletedAt)));
      const k = (p: { name: string; startDate: string; endDate: string; focus: string; color: string }) => `${p.startDate}|${p.endDate}|${p.name}|${p.focus}|${p.color}`;
      if (canonicalJson(cur.map(k).sort()) === canonicalJson(next.map(k).sort())) report.counts.phases.unchanged += next.length;
      else {
        if (cur.length) await tx.update(phases).set({ deletedAt: sql`now()` }).where(inArray(phases.id, cur.map((p) => p.id)));
        if (next.length) await tx.insert(phases).values(next.map((p) => ({ ...p, seasonId: season.id, trackId: track.id })));
        report.counts.phases.created += next.length;
        if (cur.length) report.warnings.push(`Replaced this track's ${cur.length} phase${cur.length === 1 ? "" : "s"} (the old ones are in Trash).`);
      }
    }
  }

  // ---- Events: identity mapping inside the target track (see docs/IMPORT_FORMAT.md)
  const keys = new Map<string, number>();
  for (const [i, e] of (file.events ?? []).entries()) {
    if (!e.key) continue;
    if (keys.has(e.key)) report.errors.push(`Event key “${e.key}” is used by events ${keys.get(e.key)! + 1} and ${i + 1}; keys must be unique within a file.`);
    else keys.set(e.key, i);
  }
  const outside: string[] = [];
  for (const [index, e] of (file.events ?? []).entries()) {
    const where = `Event ${index + 1} (${e.date}${e.title ? ` “${e.title}”` : ""})`;
    const tpl = e.template ? templatesByKey.get(e.template) ?? null : null;
    if (e.template && !tpl) report.warnings.push(`${where}: template “${e.template}” was not found.`);
    const loc = resolveLocation(e.location, locs);
    if (e.location && !loc) report.warnings.push(`${where}: location “${e.location}” is not in the locations list; saved as venue text.`);
    const isPlan = PLAN_KINDS.includes(e.kind);
    const blocks = e.blocks ? buildBlocks(e.blocks, drillsByKey, report.warnings, where) : (tpl?.doc.blocks ?? []).map((b) => ({ ...b, id: newBlockId() }));
    const start = e.start !== undefined ? e.start : tpl?.doc.startTime ?? (isPlan ? settings.defaultPracticeStart : null);
    const target = e.targetMinutes ?? tpl?.doc.targetMinutes ?? (isPlan ? settings.defaultPracticeMinutes : DEFAULT_PRACTICE_MINUTES);
    const end = e.end !== undefined ? e.end : start && isPlan ? addMinutesToTime(start, target) : tpl?.doc.endTime ?? null;
    if (start && end && minutesBetween(start, end) <= 0) report.warnings.push(`${where}: end time is not after start time.`);
    if (e.date < season.startDate || e.date > season.endDate) outside.push(e.date);
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
    const existing = e.key ? await findEventByKey(tx, track.id, e.key) : null;
    if (existing) {
      report.identity.matchedInTrack++;
      // Keep block ids stable when the plan content is unchanged so re-imports are no-ops.
      const { changed } = await saveEventTx(tx, actor, existing.id, null, reuseBlockIds(doc.data, existing), { action: "import", summary: "Updated by import" });
      if (changed.length) report.counts.events.updated++;
      else report.counts.events.unchanged++;
    } else {
      const identity = e.key ? await identityForKey(tx, season.id, track.id, e.key) : { logicalId: null, from: "new" as const };
      if (identity.from === "other-track") report.identity.sharedWithOtherTracks++;
      else if (identity.from === "trash") {
        report.identity.reusedFromTrash++;
        report.conflicts.push(`${where}: key “${e.key}” matches an item in Trash; the new event takes over its public identity. Restoring the old one later will ask you to choose (replace / keep both).`);
      } else report.identity.brandNew++;
      await createEventTx(tx, actor, doc.data, { trackId: track.id, logicalId: identity.logicalId, action: "import", summary: "Created by import", externalRef: e.key ?? null });
      report.counts.events.created++;
    }
  }
  if (outside.length) {
    report.warnings.push(`${outside.length} event${outside.length === 1 ? " is" : "s are"} outside the season dates (${season.startDate} → ${season.endDate}); ${outside.length === 1 ? "it is" : "they are"} still imported into this season.`);
  }
}

/** Positional block-id reuse for template documents. */
function reuseIds(blocks: Block[], prev: Block[]): Block[] {
  return blocks.map((b, i) => (prev[i] ? { ...b, id: prev[i].id, source: b.source && prev[i].source && b.source.drillId === prev[i].source!.drillId && b.source.version === prev[i].source!.version ? prev[i].source : b.source } : b));
}

async function listTemplatesTx(tx: Tx, trackId: string) {
  const rows = await tx
    .select()
    .from(templates)
    .where(and(isNull(templates.deletedAt), sql`(${templates.trackId} IS NULL OR ${templates.trackId} = ${trackId})`));
  return rows;
}

/**
 * Identity for an imported key that has NO active row in the target track:
 *  1. a UUID key naming a logical event of THIS season → that identity;
 *  2. the same key used by another track's row (or a trashed row) in this season → its identity,
 *     so variants of "the same event" in Track A and Track B publish to one public link;
 *  3. otherwise a brand-new identity. UUID keys never reach other seasons or tracks' rows by row id.
 */
async function identityForKey(tx: Tx, seasonId: string, trackId: string, key: string): Promise<{ logicalId: string | null; from: "uuid" | "other-track" | "trash" | "new" }> {
  const taken = async (logicalId: string) =>
    (await tx.select({ id: events.id }).from(events).where(and(eq(events.trackId, trackId), eq(events.logicalId, logicalId), isNull(events.deletedAt))).limit(1)).length > 0;
  if (isUuid(key)) {
    const [le] = await tx.select({ id: logicalEvents.id }).from(logicalEvents).where(and(eq(logicalEvents.id, key), eq(logicalEvents.seasonId, seasonId))).limit(1);
    if (le && !(await taken(le.id))) return { logicalId: le.id, from: "uuid" };
  }
  const rows = await tx
    .select({ logicalId: events.logicalId, deletedAt: events.deletedAt, trackId: events.trackId })
    .from(events)
    .innerJoin(tracks, eq(tracks.id, events.trackId))
    .where(and(eq(tracks.seasonId, seasonId), eq(events.externalRef, key)))
    .orderBy(sql`${events.deletedAt} NULLS FIRST`, desc(events.updatedAt));
  for (const r of rows) {
    if (await taken(r.logicalId)) continue;
    // A trashed row of THIS track with the same identity will need a decision if it is ever restored.
    const inTrash = rows.some((x) => x.trackId === trackId && x.deletedAt && x.logicalId === r.logicalId);
    return { logicalId: r.logicalId, from: inTrash ? "trash" : r.trackId !== trackId && !r.deletedAt ? "other-track" : "trash" };
  }
  return { logicalId: null, from: "new" };
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

/** Active row of the TARGET TRACK for a key: by import key, else (UUID keys) by logical id or row id — never outside the track. */
async function findEventByKey(tx: Tx, trackId: string, key: string) {
  const [byRef] = await tx.select().from(events).where(and(eq(events.trackId, trackId), eq(events.externalRef, key), isNull(events.deletedAt))).limit(1);
  if (byRef) return byRef;
  if (isUuid(key)) {
    const [row] = await tx
      .select()
      .from(events)
      .where(and(eq(events.trackId, trackId), isNull(events.deletedAt), sql`(${events.logicalId} = ${key} OR ${events.id} = ${key})`))
      .limit(1);
    if (row) return row;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export (PLANNING export — working copies with private notes; administrators only)
// ---------------------------------------------------------------------------
/**
 * A planning export is the gl-fencing-plan v1 format plus a versioned
 * `planningExport` extension. It is the coaches' WORKING copies (drafts and
 * private notes) — NOT an image of the public schedule. Published backups are
 * separate, self-contained snapshots (see backups). Importers that only know
 * v1 ignore the extension; this app ignores it on import too.
 *
 * - with `trackId`: one track (importable into any track for a round trip);
 * - without: the default season's first track at the top level (importable),
 *   plus every season/track under `planningExport.workspaces`.
 */
export async function exportAll(opts: { trackId?: string | null } = {}) {
  const db = getDb();
  const settings = await getSettings(db);
  const locs = await listLocations({ includeArchived: true });
  const workspaces = await listWorkspaces(db);
  let primary = opts.trackId && isUuid(opts.trackId) ? workspaces.flatMap((s) => s.tracks.map((t) => ({ s, t }))).find((x) => x.t.id === opts.trackId) ?? null : null;
  if (opts.trackId && !primary) throw new Error("That planning track no longer exists.");
  if (!primary) {
    const s = pickDefaultSeason(workspaces, todayInTimeZone(settings.timezone));
    primary = s && s.tracks[0] ? { s, t: s.tracks[0] } : null;
  }
  const roster = await db.select({ name: users.name, email: users.email, role: users.role, disabledAt: users.disabledAt }).from(users).orderBy(asc(users.name));
  const locName = (id: string | null) => locs.find((l) => l.id === id)?.name;
  const allDrills = await listDrills({});
  const local = primary ? await listDrills({ trackId: primary.t.id }) : allDrills;
  const drillKey = (id: string) => local.find((d) => d.id === id)?.externalRef ?? allDrills.find((d) => d.id === id)?.externalRef ?? id;
  const trackPhases = async (trackId: string) =>
    (await db.select().from(phases).where(and(eq(phases.trackId, trackId), isNull(phases.deletedAt))).orderBy(asc(phases.startDate))).map((p) => ({
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      focus: p.focus,
      color: p.color,
    }));
  const trackEvents = async (trackId: string) =>
    (await listTrackEvents(trackId, db)).map((e) => ({
      key: e.externalRef ?? e.logicalId,
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
    }));
  const tpls = primary ? await listTemplates({ trackId: primary.t.id }) : await listTemplates();
  const allWorkspaces = opts.trackId
    ? undefined
    : await Promise.all(
        workspaces.map(async (s) => ({
          season: { name: s.name, startDate: s.startDate, endDate: s.endDate, publicVisible: s.publicVisible },
          tracks: await Promise.all(s.tracks.map(async (t) => ({ name: t.name, description: t.description, phases: await trackPhases(t.id), events: await trackEvents(t.id) }))),
        })),
      );

  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    exportedAt: new Date().toISOString(),
    planningExport: {
      version: PLANNING_EXPORT_VERSION,
      kind: opts.trackId ? "track" : "all",
      note: "Planning export: coaches' working copies including private notes. It is not an exact image of the public schedule; published backups are kept separately in the app.",
      season: primary?.s.name ?? null,
      track: primary?.t.name ?? null,
      workspaces: allWorkspaces,
    },
    team: { name: settings.teamName, shortName: settings.shortName, timezone: settings.timezone, publicIntro: settings.publicIntro, defaultPracticeMinutes: settings.defaultPracticeMinutes, defaultPracticeStart: settings.defaultPracticeStart },
    coaches: roster.map((u) => ({ name: u.name, email: u.email, role: u.role, active: !u.disabledAt })),
    locations: locs.map((l) => ({ name: l.name, shortName: l.shortName, address: l.address, kind: l.kind, notes: l.notes, archived: Boolean(l.archivedAt) })),
    drills: local.map((d) => ({
      key: d.externalRef ?? d.id,
      title: d.title,
      weapons: d.weapons,
      category: d.category,
      skills: d.skills,
      level: d.level,
      durationMin: d.durationMin,
      tags: d.tags,
      coachNotes: d.coachNotes,
      trackOnly: !!d.trackId,
      ...d.details,
    })),
    templates: tpls.map((t) => ({
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
      trackOnly: !!t.trackId,
      blocks: t.doc.blocks.map((b) => exportBlock(b, drillKey)),
    })),
    seasons: primary ? [{ name: primary.s.name, startDate: primary.s.startDate, endDate: primary.s.endDate, phases: await trackPhases(primary.t.id) }] : [],
    events: primary ? await trackEvents(primary.t.id) : [],
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
