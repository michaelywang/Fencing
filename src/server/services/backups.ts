import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/server/db";
import { backupSlots, backupSnapshots, clearBatches, locations, publishLog, teamSettings, users } from "@/server/db/schema";
import { AppError, badRequest, forbidden, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { BACKUP_SCHEMA_VERSION, SLOT_COUNT, type BackupEventEntry, type BackupPhase, type LiveScope } from "@/lib/liveTypes";
import { canonicalJson, publicContentHash, sha256 } from "@/server/live/hash";
import {
  bumpGeneration,
  liveRowsInScope,
  lockSeason,
  logLive,
  phaseKey,
  publicPhasesInScope,
  replacePublicPhases,
  writeLive,
  type SeasonRow,
} from "@/server/live/store";
import { runOperation } from "./operations";
import { getSeason } from "./scope";
import { isUuid } from "./ids";

export type SnapshotRow = typeof backupSnapshots.$inferSelect;

export interface SlotInfo {
  slot: number;
  snapshotId: string;
  label: string;
  assignedAt: string;
  assignedByName: string | null;
  createdAt: string;
  createdByName: string | null;
  reason: string;
  scope: LiveScope;
  dateFrom: string | null;
  dateTo: string | null;
  eventCount: number;
  phaseCount: number | null;
  meta: SnapshotRow["meta"];
}

export interface SlotPlan {
  slots: Array<SlotInfo | null>;
  /** First free slot, or null when all three are occupied and the coach must choose one to replace. */
  firstEmpty: number | null;
}

/** Order-independent fingerprint of a public state (events + optional phases). */
export function stateHash(entries: Array<Pick<BackupEventEntry, "logicalId" | "payload">>, phases: BackupPhase[] | null): string {
  const ev = entries
    .map((e) => [e.logicalId, publicContentHash(e.payload)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return sha256(canonicalJson({ ev, ph: phases ? phases.map(phaseKey).sort() : null }));
}

async function currentState(db: DbOrTx, scope: LiveScope, includePhases: boolean) {
  const live = await liveRowsInScope(db, scope);
  const entries: BackupEventEntry[] = live.map((r) => ({ logicalId: r.logicalId, date: r.date, startTime: r.startTime, kind: r.kind, status: r.status, payload: r.payload }));
  const phases: BackupPhase[] | null = includePhases
    ? (await publicPhasesInScope(db, scope)).map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate, focus: p.focus, color: p.color }))
    : null;
  return { entries, phases, hash: stateHash(entries, phases) };
}

/**
 * Captures the EXACT current public state of a scope as an immutable,
 * self-contained snapshot: public payloads (with resolved venue/coach display),
 * published phases, season display data and publication metadata. Nothing is
 * read from private drafts or the mutable library.
 */
export async function captureSnapshot(
  tx: Tx,
  season: SeasonRow,
  scope: LiveScope,
  opts: { includePhases: boolean; reason: string; actor: SessionUser | null; operationId?: string | null },
): Promise<SnapshotRow> {
  const { entries, phases, hash } = await currentState(tx, scope, opts.includePhases);
  const [settings] = await tx.select().from(teamSettings).limit(1);
  const [lastLog] = await tx.select().from(publishLog).where(eq(publishLog.seasonId, season.id)).orderBy(desc(publishLog.createdAt)).limit(1);
  const dates = entries.map((e) => e.date).sort();
  const [row] = await tx
    .insert(backupSnapshots)
    .values({
      seasonId: season.id,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      reason: opts.reason,
      scope,
      dateFrom: scope.from ?? dates[0] ?? null,
      dateTo: scope.to ?? dates[dates.length - 1] ?? null,
      eventCount: entries.length,
      events: entries,
      phases,
      season: { name: season.name, startDate: season.startDate, endDate: season.endDate },
      meta: {
        capturedAt: new Date().toISOString(),
        liveGeneration: season.liveGeneration,
        lastUpdatedAt: season.liveUpdatedAt,
        lastPublicNote: lastLog?.note ?? "",
        teamName: settings?.teamName ?? "",
        publicIntro: settings?.publicIntro ?? "",
        showCoachNamesPublicly: settings?.showCoachNamesPublicly ?? true,
      },
      contentHash: hash,
      operationId: opts.operationId ?? null,
      createdBy: opts.actor?.id ?? null,
    })
    .returning();
  return row;
}

const creator = users;

export async function slotPlan(db: DbOrTx, seasonId: string): Promise<SlotPlan> {
  const rows = await db
    .select({ slot: backupSlots, snap: backupSnapshots, assignedByName: users.name })
    .from(backupSlots)
    .innerJoin(backupSnapshots, eq(backupSnapshots.id, backupSlots.snapshotId))
    .leftJoin(users, eq(users.id, backupSlots.assignedBy))
    .where(eq(backupSlots.seasonId, seasonId))
    .orderBy(asc(backupSlots.slot));
  const creators = new Map<string, string>();
  for (const r of rows) {
    if (r.snap.createdBy && !creators.has(r.snap.createdBy)) {
      const [u] = await db.select({ name: creator.name }).from(creator).where(eq(creator.id, r.snap.createdBy)).limit(1);
      if (u) creators.set(r.snap.createdBy, u.name);
    }
  }
  const slots: Array<SlotInfo | null> = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const r = rows.find((x) => x.slot.slot === i + 1);
    if (!r) return null;
    return {
      slot: r.slot.slot,
      snapshotId: r.snap.id,
      label: r.slot.label,
      assignedAt: r.slot.assignedAt,
      assignedByName: r.assignedByName,
      createdAt: r.snap.createdAt,
      createdByName: r.snap.createdBy ? creators.get(r.snap.createdBy) ?? null : null,
      reason: r.snap.reason,
      scope: r.snap.scope,
      dateFrom: r.snap.dateFrom,
      dateTo: r.snap.dateTo,
      eventCount: r.snap.eventCount,
      phaseCount: r.snap.phases ? r.snap.phases.length : null,
      meta: r.snap.meta,
    };
  });
  const empty = slots.findIndex((s) => s === null);
  return { slots, firstEmpty: empty === -1 ? null : empty + 1 };
}

/** Deletes a snapshot once nothing (slot or Trash batch) references it. */
async function collectSnapshot(tx: Tx, snapshotId: string) {
  await tx.execute(sql`
    DELETE FROM backup_snapshots s WHERE s.id = ${snapshotId}
      AND NOT EXISTS (SELECT 1 FROM backup_slots b WHERE b.snapshot_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM clear_batches c WHERE c.backup_snapshot_id = s.id)`);
}

/**
 * Chooses the slot a new automatic backup goes to: an explicit choice, else
 * the first empty slot. When all three are full and no choice was made, the
 * operation stops (409) so the coach can pick one — backups are never evicted silently.
 */
export async function resolveTargetSlot(tx: Tx, seasonId: string, requested: number | null | undefined): Promise<number> {
  if (requested !== undefined && requested !== null) {
    if (!Number.isInteger(requested) || requested < 1 || requested > SLOT_COUNT) throw badRequest("Backup slot must be 1, 2 or 3.");
    return requested;
  }
  const plan = await slotPlan(tx, seasonId);
  if (plan.firstEmpty) return plan.firstEmpty;
  throw new AppError(409, "slot_choice_required", "All three backup slots are in use. Choose which saved backup to replace, or cancel.", { slots: plan.slots });
}

export async function placeSnapshot(tx: Tx, seasonId: string, slot: number, snapshot: SnapshotRow, label: string, actor: SessionUser | null) {
  const [existing] = await tx
    .select()
    .from(backupSlots)
    .where(and(eq(backupSlots.seasonId, seasonId), eq(backupSlots.slot, slot)))
    .for("update")
    .limit(1);
  if (existing) {
    await tx
      .update(backupSlots)
      .set({ snapshotId: snapshot.id, label: label.slice(0, 120), assignedAt: sql`now()`, assignedBy: actor?.id ?? null })
      .where(and(eq(backupSlots.seasonId, seasonId), eq(backupSlots.slot, slot)));
    await collectSnapshot(tx, existing.snapshotId);
  } else {
    await tx.insert(backupSlots).values({ seasonId, slot, snapshotId: snapshot.id, label: label.slice(0, 120), assignedBy: actor?.id ?? null });
  }
}

function defaultLabel(reason: string, when = new Date()): string {
  const stamp = when.toISOString().slice(0, 16).replace("T", " ");
  const what =
    reason === "before-clear" ? "Before clearing" : reason === "before-replace" ? "Before replacing" : reason === "swap" ? "Live before restore" : "Saved";
  return `${what} (${stamp} UTC)`;
}

export async function listBackups(seasonId: string): Promise<SlotPlan> {
  if (!isUuid(seasonId)) throw notFound("Season not found.");
  return slotPlan(getDb(), seasonId);
}

export async function getBackup(seasonId: string, slot: number) {
  const plan = await listBackups(seasonId);
  const info = plan.slots[slot - 1];
  if (!info) throw notFound("That backup slot is empty.");
  const [snap] = await getDb().select().from(backupSnapshots).where(eq(backupSnapshots.id, info.snapshotId)).limit(1);
  return { info, events: snap.events, phases: snap.phases, season: snap.season };
}

export async function getSnapshot(id: string, db: DbOrTx = getDb()): Promise<SnapshotRow | null> {
  if (!isUuid(id)) return null;
  const [snap] = await db.select().from(backupSnapshots).where(eq(backupSnapshots.id, id)).limit(1);
  return snap ?? null;
}

/** Replaces the live schedule in `scope` with exactly `entries` (+ phases). Caller holds the season lock. */
export async function applyStateToLive(
  tx: Tx,
  season: SeasonRow,
  gen: number,
  scope: LiveScope,
  entries: BackupEventEntry[],
  phases: BackupPhase[] | null,
  meta: { action: string; actor: SessionUser | null; operationId?: string | null },
) {
  const current = await liveRowsInScope(tx, scope);
  const wanted = new Map(entries.map((e) => [e.logicalId, e]));
  // Re-link restored venues to current shared locations when one still matches (display data comes from the snapshot).
  const locs = await tx.select({ id: locations.id, name: locations.name, address: locations.address }).from(locations);
  const locationIdFor = (p: BackupEventEntry["payload"]) => (p.location ? locs.find((l) => l.name === p.location!.name && l.address === p.location!.address)?.id ?? null : null);
  let removed = 0;
  let written = 0;
  for (const live of current) {
    if (!wanted.has(live.logicalId)) {
      await writeLive(tx, season, gen, { logicalId: live.logicalId, payload: null }, meta);
      removed++;
    }
  }
  const currentById = new Map(current.map((c) => [c.logicalId, c]));
  for (const e of entries) {
    const cur = currentById.get(e.logicalId);
    if (cur && publicContentHash(cur.payload) === publicContentHash(e.payload) && JSON.stringify(cur.payload.notice ?? null) === JSON.stringify(e.payload.notice ?? null)) continue;
    await writeLive(tx, season, gen, { logicalId: e.logicalId, payload: e.payload, sourceRowId: null, sourceTrackId: null, locationId: locationIdFor(e.payload) }, meta);
    written++;
  }
  if (phases) await replacePublicPhases(tx, scope, phases);
  return { removed, written };
}

/**
 * ONE-CLICK RESTORE as a reversible swap: the slot's saved state becomes live
 * and the previous live state (same scope) takes that slot. The other slots are
 * untouched. Retries with the same operation id replay; a no-op restore (live
 * already equals the backup) does not rotate anything.
 */
export async function restoreBackup(
  actor: SessionUser,
  input: { seasonId: string; slot: number; expectedSnapshotId?: string; operationId?: string },
) {
  if (!isUuid(input.seasonId)) throw notFound("Season not found.");
  return runOperation(input.operationId, "restore-backup", actor, input.seasonId, async (tx) => {
    const season = await lockSeason(tx, input.seasonId);
    const [slotRow] = await tx
      .select()
      .from(backupSlots)
      .where(and(eq(backupSlots.seasonId, season.id), eq(backupSlots.slot, input.slot)))
      .for("update")
      .limit(1);
    if (!slotRow) throw notFound("That backup slot is empty.");
    if (input.expectedSnapshotId && slotRow.snapshotId !== input.expectedSnapshotId) {
      throw new AppError(409, "slot_changed", "This backup slot changed since you loaded the page (another coach restored or replaced it). Reload and try again.");
    }
    const [snap] = await tx.select().from(backupSnapshots).where(eq(backupSnapshots.id, slotRow.snapshotId)).limit(1);
    const includePhases = snap.phases !== null;
    const now = await currentState(tx, snap.scope, includePhases);
    if (now.hash === snap.contentHash) {
      return { noop: true, slot: input.slot, snapshotId: slotRow.snapshotId, generation: season.liveGeneration, removed: 0, written: 0 };
    }
    const previousLive = await captureSnapshot(tx, season, snap.scope, { includePhases, reason: "swap", actor, operationId: input.operationId });
    const gen = await bumpGeneration(tx, season);
    const counts = await applyStateToLive(tx, season, gen, snap.scope, snap.events, snap.phases, { action: "restore-backup", actor, operationId: input.operationId });
    await tx
      .update(backupSlots)
      .set({ snapshotId: previousLive.id, label: `Live before restoring “${slotRow.label}”`.slice(0, 120), assignedAt: sql`now()`, assignedBy: actor.id })
      .where(and(eq(backupSlots.seasonId, season.id), eq(backupSlots.slot, input.slot)));
    await collectSnapshot(tx, snap.id);
    await logLive(tx, season, {
      action: "restore-backup",
      actor,
      publicNote: "Schedule restored to an earlier version",
      count: counts.removed + counts.written,
      operationId: input.operationId,
      details: { slot: input.slot, restoredSnapshot: snap.id, savedPreviousLive: previousLive.id, scope: snap.scope, ...counts },
    });
    return { noop: false, slot: input.slot, snapshotId: previousLive.id, generation: gen, ...counts };
  });
}

/** Saves the current live schedule (scope) into a slot. All slots full ⇒ an explicit slot is required. */
export async function backupNow(
  actor: SessionUser,
  input: { seasonId: string; scope: LiveScope; includePhases?: boolean; slot?: number | null; label?: string; operationId?: string },
) {
  return runOperation(input.operationId, "backup-now", actor, input.seasonId, async (tx) => {
    const season = await lockSeason(tx, input.seasonId);
    const slot = await resolveTargetSlot(tx, season.id, input.slot);
    const snap = await captureSnapshot(tx, season, input.scope, { includePhases: input.includePhases ?? true, reason: "manual", actor, operationId: input.operationId });
    await placeSnapshot(tx, season.id, slot, snap, input.label?.trim() || defaultLabel("manual"), actor);
    return { slot, snapshotId: snap.id, eventCount: snap.eventCount };
  });
}

export async function renameBackup(actor: SessionUser, input: { seasonId: string; slot: number; label: string }) {
  const label = input.label.trim().slice(0, 120);
  if (!label) throw badRequest("Give the backup a name.");
  const res = await getDb()
    .update(backupSlots)
    .set({ label })
    .where(and(eq(backupSlots.seasonId, input.seasonId), eq(backupSlots.slot, input.slot)))
    .returning({ slot: backupSlots.slot });
  if (res.length === 0) throw notFound("That backup slot is empty.");
}

/** Administrators only: permanently deletes a saved backup. */
export async function deleteBackup(actor: SessionUser, input: { seasonId: string; slot: number; expectedSnapshotId: string }) {
  if (actor.role !== "admin") throw forbidden("Only administrators can permanently delete a backup.");
  await getDb().transaction(async (tx) => {
    await lockSeason(tx, input.seasonId);
    const [slotRow] = await tx
      .select()
      .from(backupSlots)
      .where(and(eq(backupSlots.seasonId, input.seasonId), eq(backupSlots.slot, input.slot)))
      .for("update")
      .limit(1);
    if (!slotRow) throw notFound("That backup slot is empty.");
    if (slotRow.snapshotId !== input.expectedSnapshotId) throw new AppError(409, "slot_changed", "This slot changed since you loaded the page. Reload and try again.");
    await tx.delete(backupSlots).where(and(eq(backupSlots.seasonId, input.seasonId), eq(backupSlots.slot, input.slot)));
    // Trash batches may still reference the snapshot as their "before clear" record; it is then kept.
    await collectSnapshot(tx, slotRow.snapshotId);
  });
}

export { defaultLabel };

/** Used by the clear/replace flows: capture + place in the chosen (or first free) slot. */
export async function backupBeforeLiveChange(
  tx: Tx,
  season: SeasonRow,
  scope: LiveScope,
  opts: { includePhases: boolean; reason: "before-clear" | "before-replace"; actor: SessionUser; slot: number | null | undefined; operationId?: string | null },
) {
  const slot = await resolveTargetSlot(tx, season.id, opts.slot);
  const snap = await captureSnapshot(tx, season, scope, { includePhases: opts.includePhases, reason: opts.reason, actor: opts.actor, operationId: opts.operationId });
  await placeSnapshot(tx, season.id, slot, snap, defaultLabel(opts.reason), opts.actor);
  return { slot, snapshot: snap };
}

export async function seasonForBackup(seasonId: string) {
  const s = await getSeason(seasonId);
  if (!s) throw notFound("Season not found.");
  return s;
}

export { clearBatches };
