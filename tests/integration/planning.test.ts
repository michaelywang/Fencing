/**
 * Planning tracks, explicit publication, clear/Trash, backups and logistics
 * patches — the acceptance scenarios (numbers refer to the requirements list).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { backupSlots, events, locations, publicEvents, seasons, tracks } from "@/server/db/schema";
import { createEvent, getEvent, listTrackEvents, saveEvent } from "@/server/services/events";
import { deleteEvent, getLiveLogistics, listPublications, publish, publishLogistics, publishPhases, reviewPublication, saveAndPublish, setCanceled, undoLogistics } from "@/server/services/publishing";
import { backupNow, listBackups, restoreBackup } from "@/server/services/backups";
import { executeClear, listTrash, previewClear, previewPurge, purgeTrash, restoreFromTrash } from "@/server/services/trash";
import { createTrack, removeTrack } from "@/server/services/tracks";
import { createDrill, createPhase, listDrills, updateDrill } from "@/server/services/library";
import { runImport } from "@/server/services/transfer";
import { getPhasesInRange, getPublicEvent, getPublicEvents, getPublicMeta } from "@/server/services/public";
import { AppError, ConflictError } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { CMS_ID, GL_ID, SEASON_ID, SECRET, TRACK_A, makeUser, practiceDoc, resetDb } from "./helpers";

beforeEach(resetDb);

const uuid = () => crypto.randomUUID();
const SEASON_RANGE = ["2026-08-01", "2027-07-31"] as const;
const allPublic = () => getPublicEvents(SEASON_RANGE[0], "2027-07-31");

async function seedA(coach: SessionUser, dates = ["2026-09-14", "2026-11-09", "2026-11-11", "2027-02-08"]) {
  const rows = [];
  for (const date of dates) rows.push(await createEvent(coach, practiceDoc({ date, title: `Practice ${date}` }), { trackId: TRACK_A }));
  return rows;
}

async function publishAll(coach: SessionUser, trackId: string) {
  const rows = await listTrackEvents(trackId);
  return publish(coach, { trackId, mode: "selected", rowIds: rows.map((r) => r.id) });
}

async function replace(coach: SessionUser, trackId: string, scope: { from?: string | null; to?: string | null; kinds?: string[] | null } | null, extra: Record<string, unknown> = {}) {
  const review = await reviewPublication(trackId, { mode: "replace", scope, includePhases: !!extra.includePhases });
  return { review, result: await publish(coach, { trackId, mode: "replace", scope, token: review.token, ...extra }) };
}

async function clear(coach: SessionUser, trackId: string, target: "track" | "public" | "both", scope: { from?: string; to?: string; kinds?: string[] } | null, extra: Record<string, unknown> = {}) {
  const preview = await previewClear({ trackId, target, scope, ...extra });
  return { preview, result: await executeClear(coach, { trackId, target, scope, token: preview.token, ...extra }) };
}

const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

describe("1 · tracks: faithful duplicate, isolation, A stays publicly unchanged", () => {
  it("duplicates A into B faithfully and edits to B (events, phases, imports) never reach A or the public site", async () => {
    const coach = await makeUser();
    const [sep, nov] = await seedA(coach);
    await saveEvent(coach, nov.id, {
      baseVersion: nov.version,
      doc: { ...practiceDoc({ date: "2026-11-09", title: "Practice 2026-11-09" }), confirmation: "tentative", status: "canceled", cancelReason: "Gym", completedNotes: "Went well", privateNotes: `${SECRET} A` },
    });
    await createPhase(coach, { seasonId: SEASON_ID, trackId: TRACK_A, name: "Foundations", startDate: "2026-09-01", endDate: "2026-11-30" });
    await publishAll(coach, TRACK_A);
    await publishPhases(coach, { trackId: TRACK_A });
    const publicBefore = JSON.stringify(await allPublic());

    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "duplicate", sourceTrackId: TRACK_A });
    const bRows = await listTrackEvents(B);
    const aRows = await listTrackEvents(TRACK_A);
    expect(bRows).toHaveLength(aRows.length);
    const bNov = bRows.find((r) => r.date === "2026-11-09")!;
    expect(bNov.logicalId).toBe(nov.logicalId); // same logical identity
    expect(bNov.id).not.toBe(nov.id); // separate working copy
    expect(bNov).toMatchObject({ confirmation: "tentative", status: "canceled", cancelReason: "Gym", completedNotes: "Went well", privateNotes: `${SECRET} A` });
    expect(bNov.coachAssignments.foil).toBe("Coach A");
    expect(bNov.blocks.map((b) => b.id)).toEqual((await getEvent(nov.id))!.blocks.map((b) => b.id));
    expect(bNov.publication).toBe("published"); // same content as live

    // Edit B: plan, phases, a track-only import with a drill
    await saveEvent(coach, bRows[0].id, { baseVersion: bRows[0].version, doc: { ...bRows[0], theme: "B experiment" } });
    await createPhase(coach, { seasonId: SEASON_ID, trackId: B, name: "B-only phase", startDate: "2026-12-01", endDate: "2026-12-31" });
    const sharedBefore = await listDrills();
    const imp = await runImport(coach, { format: "gl-fencing-plan", version: 1, drills: [{ key: "b-drill", title: "B drill" }], events: [{ key: "b-1", date: "2026-12-02", blocks: [{ lane: "shared", drill: "b-drill", duration: 150 }] }] }, { dryRun: false, trackId: B });
    expect(imp.ok).toBe(true);
    expect(await listDrills()).toEqual(sharedBefore); // shared library untouched
    expect((await listDrills({ trackId: B })).some((d) => d.title === "B drill")).toBe(true);
    expect((await listDrills({ trackId: TRACK_A })).some((d) => d.title === "B drill")).toBe(false);

    expect(JSON.stringify(await allPublic())).toBe(publicBefore);
    expect((await getEvent(sep.id))!.theme).toBe("Parry-riposte foundations");
    expect(await listTrackEvents(TRACK_A)).toHaveLength(4);
    expect((await getPhasesInRange("2026-12-01", "2026-12-31")).length).toBe(0);
  });

  it("creates a track from the published schedule with only public content", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach, ["2026-11-09"]);
    await publishAll(coach, TRACK_A);
    await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: "unpublished draft idea" } });
    const { trackId } = await createTrack(coach, { seasonId: SEASON_ID, name: "From live", mode: "published" });
    const [row] = await listTrackEvents(trackId);
    expect(row.logicalId).toBe(ev.logicalId);
    expect(row.theme).toBe("Parry-riposte foundations");
    expect(row.privateNotes).toBe("");
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(row.publication).toBe("published");
  });
});

describe("2 · publish selected vs. scoped replacement", () => {
  it("publishes one event from B keeping links and other dates, and a full replacement removes omitted events without duplicates", async () => {
    const coach = await makeUser();
    const a = await seedA(coach);
    await publishAll(coach, TRACK_A);
    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "duplicate", sourceTrackId: TRACK_A });
    const b = await listTrackEvents(B);
    const bNov = b.find((r) => r.date === "2026-11-09")!;
    await saveEvent(coach, bNov.id, { baseVersion: bNov.version, doc: { ...bNov, theme: "B theme" } });

    const res = await publish(coach, { trackId: B, mode: "selected", rowIds: [bNov.id] });
    expect(res.published).toBe(1);
    expect((await getPublicEvent(bNov.logicalId))!.theme).toBe("B theme"); // same /e/<id>
    expect(await allPublic()).toHaveLength(4); // no duplicate variant
    expect((await getPublicEvent(a[0].logicalId))!.theme).toBe("Parry-riposte foundations");
    expect((await getEvent(a[1].id))!.publication).toBe("changed"); // A now differs from live

    // B drops the February practice and moves Nov 11 → Dec 2 (crossing out of a Nov scope)
    const feb = b.find((r) => r.date === "2027-02-08")!;
    await deleteEvent(coach, feb.id);
    const nov11 = b.find((r) => r.date === "2026-11-11")!;
    await saveEvent(coach, nov11.id, { baseVersion: nov11.version, doc: { ...nov11, date: "2026-12-02" } });

    const novReview = await reviewPublication(B, { mode: "replace", scope: { from: "2026-11-01", to: "2026-11-30" } });
    const moved = novReview.items.find((i) => i.logicalId === nov11.logicalId)!;
    expect(moved.crossesScope).toBe("out");
    expect(moved.before?.date).toBe("2026-11-11");
    expect(moved.after?.date).toBe("2026-12-02");
    expect(novReview.items.some((i) => i.logicalId === feb.logicalId)).toBe(false); // Feb is out of scope
    expect(novReview.counts.outOfScopePreserved).toBe(2);

    const { review, result } = await replace(coach, B, null);
    expect(review.counts.remove).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.backupSlot).toBe(1); // backup before bulk replacement
    const live = await allPublic();
    expect(live).toHaveLength(3);
    expect(new Set(live.map((e) => e.id)).size).toBe(3);
    expect(await getPublicEvent(feb.logicalId)).toBeNull();
    expect((await getPublicEvent(nov11.logicalId))!.date).toBe("2026-12-02");
    expect(JSON.stringify(live)).not.toContain(SECRET);
  });

  it("a stale review token is rejected and the scope never comes from the visible month", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach);
    const review = await reviewPublication(TRACK_A, { mode: "replace", scope: null });
    expect(review.counts.add).toBe(4); // every month of the season
    await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc({ date: ev.date }), theme: "changed after review" } });
    const err = await publish(coach, { trackId: TRACK_A, mode: "replace", scope: null, token: review.token }).catch((e) => e);
    expect(code(err)).toBe("review_stale");
    expect(await allPublic()).toHaveLength(0);
  });
});

describe("3 · clearing a whole season into one Trash batch", () => {
  it("clears every month of the track, leaves other tracks and the library intact, and restores as one batch", async () => {
    const coach = await makeUser();
    await seedA(coach);
    await createPhase(coach, { seasonId: SEASON_ID, trackId: TRACK_A, name: "Phase", startDate: "2026-09-01", endDate: "2026-10-31" });
    await createDrill(coach, { title: "Shared drill" });
    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "duplicate", sourceTrackId: TRACK_A });
    const { preview, result } = await clear(coach, TRACK_A, "track", null, { includePhases: true });
    expect(preview.private).toMatchObject({ events: 4, phases: 1 });
    expect(preview.public).toBeNull();
    expect(result.batchId).toBeTruthy();
    expect(await listTrackEvents(TRACK_A)).toHaveLength(0);
    expect(await listTrackEvents(B)).toHaveLength(4);
    expect((await listDrills()).map((d) => d.title)).toEqual(["Shared drill"]);
    const trash = await listTrash(SEASON_ID);
    expect(trash.batches).toHaveLength(1);
    expect(trash.batches[0].remaining).toMatchObject({ events: 4, phases: 1 });
    const back = await restoreFromTrash(coach, { seasonId: SEASON_ID, batchId: result.batchId! });
    expect(back.restored).toMatchObject({ events: 4, phases: 1 });
    expect(back.published).toBe(0); // drafts by default
    expect(await listTrackEvents(TRACK_A)).toHaveLength(4);
  });

  it("clears only practices when narrowed by kind, and a delayed pre-clear autosave is rejected even after restore", async () => {
    const coach = await makeUser();
    const [p1] = await seedA(coach, ["2026-11-09"]);
    await createEvent(coach, practiceDoc({ date: "2026-11-12", kind: "meet", blocks: [] }), { trackId: TRACK_A });
    const { result } = await clear(coach, TRACK_A, "track", { kinds: ["practice"] });
    expect(result.counts.events).toBe(1);
    expect((await listTrackEvents(TRACK_A)).map((e) => e.kind)).toEqual(["meet"]);
    await restoreFromTrash(coach, { seasonId: SEASON_ID, batchId: result.batchId! });
    const err = await saveEvent(coach, p1.id, { baseVersion: p1.version, doc: { ...practiceDoc(), theme: "late autosave" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
  });
});

describe("4–5 · clearing published events with private edits; backup survives Empty Trash", () => {
  it("backs up the LIVE version, keeps the private version in Trash, and restoring never exposes the edits", async () => {
    const coach = await makeUser();
    const admin = await makeUser("admin");
    const [ev] = await seedA(coach, ["2026-11-09", "2026-12-07"]);
    await createPhase(coach, { seasonId: SEASON_ID, trackId: TRACK_A, name: "Live phase", startDate: "2026-11-01", endDate: "2026-12-31" });
    await publishAll(coach, TRACK_A);
    await publishPhases(coach, { trackId: TRACK_A });
    await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: `UNPUBLISHED ${SECRET}` } });

    const { preview, result } = await clear(coach, TRACK_A, "both", null, { includePhases: true });
    expect(preview.public).toMatchObject({ events: 2, phases: 1 });
    expect(result.backupSlot).toBe(1);
    expect(await allPublic()).toHaveLength(0);
    expect(await getPhasesInRange("2026-11-01", "2026-12-31")).toHaveLength(0);
    const [slot1] = (await listBackups(SEASON_ID)).slots;
    expect(slot1).toMatchObject({ eventCount: 2, reason: "before-clear", phaseCount: 1 });
    const snapText = JSON.stringify(await getDb().execute(sql`SELECT events FROM backup_snapshots`));
    expect(snapText).not.toContain("UNPUBLISHED");
    expect(snapText).not.toContain(SECRET);
    const trashed = await getDb().select().from(events).where(eq(events.id, ev.id));
    expect(JSON.stringify(trashed[0].content)).toContain("UNPUBLISHED"); // Trash keeps the private version

    // 5 · Empty Trash permanently (admin), then restore the backup
    const purgeReq = { scope: "season" as const, seasonId: SEASON_ID };
    const counts = await previewPurge(admin, purgeReq);
    await expect(purgeTrash(coach, { ...purgeReq, expectedCount: counts.total })).rejects.toMatchObject({ code: "forbidden" });
    await purgeTrash(admin, { ...purgeReq, expectedCount: counts.total });
    expect(await getDb().select().from(events)).toHaveLength(0);
    expect((await listBackups(SEASON_ID)).slots[0]).not.toBeNull(); // backups untouched

    const restored = await restoreBackup(coach, { seasonId: SEASON_ID, slot: 1 });
    expect(restored.noop).toBe(false);
    const pub = await getPublicEvent(ev.logicalId); // same /e/<id> link works
    expect(pub!.theme).toBe("Parry-riposte foundations");
    expect(JSON.stringify(await allPublic())).not.toContain(SECRET);
    expect(await getPhasesInRange("2026-11-01", "2026-12-31")).toHaveLength(1);
    const meta = await getPublicMeta();
    expect(meta.lastNote).toBe("Schedule restored to an earlier version");
  });
});

describe("6 · three slots, explicit replacement choice, reversible swaps", () => {
  it("requires a slot choice when full, swaps back and forth, and ignores duplicate/no-op restores", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach, ["2026-11-09"]);
    await publishAll(coach, TRACK_A);
    const scope = { seasonId: SEASON_ID, from: null, to: null, kinds: null };
    for (let i = 0; i < 3; i++) await backupNow(coach, { seasonId: SEASON_ID, scope, label: `manual ${i + 1}` });
    const full = await listBackups(SEASON_ID);
    expect(full.firstEmpty).toBeNull();

    const preview = await previewClear({ trackId: TRACK_A, target: "public", scope: null });
    expect(preview.backup?.firstEmpty).toBeNull();
    const err = await executeClear(coach, { trackId: TRACK_A, target: "public", scope: null, token: preview.token }).catch((e) => e);
    expect(code(err)).toBe("slot_choice_required");
    expect(await allPublic()).toHaveLength(1); // nothing happened
    await executeClear(coach, { trackId: TRACK_A, target: "public", scope: null, token: preview.token, slot: 2 });
    const afterClear = await listBackups(SEASON_ID);
    expect(afterClear.slots[0]!.snapshotId).toBe(full.slots[0]!.snapshotId);
    expect(afterClear.slots[2]!.snapshotId).toBe(full.slots[2]!.snapshotId);
    expect(afterClear.slots[1]!.reason).toBe("before-clear");
    expect(await allPublic()).toHaveLength(0); // empty live schedule is a valid state

    // one-click restore of slot 2 → live again; slot 2 now holds the (empty) previous live state
    const op = uuid();
    const r1 = await restoreBackup(coach, { seasonId: SEASON_ID, slot: 2, operationId: op });
    expect(r1.noop).toBe(false);
    expect((await getPublicEvent(ev.logicalId))!.title).toBe("Practice 2026-11-09");
    const again = await restoreBackup(coach, { seasonId: SEASON_ID, slot: 2, operationId: op }); // retry after lost response
    expect(again.replayed).toBe(true);
    expect(await allPublic()).toHaveLength(1);
    const s2 = (await listBackups(SEASON_ID)).slots[1]!;
    expect(s2.eventCount).toBe(0);
    expect(s2.reason).toBe("swap");

    // swap back: empty again, then forward again
    await restoreBackup(coach, { seasonId: SEASON_ID, slot: 2 });
    expect(await allPublic()).toHaveLength(0);
    await restoreBackup(coach, { seasonId: SEASON_ID, slot: 2 });
    expect(await allPublic()).toHaveLength(1);
    const final = await listBackups(SEASON_ID);
    expect(final.slots[0]!.snapshotId).toBe(full.slots[0]!.snapshotId);
    expect(final.slots[2]!.snapshotId).toBe(full.slots[2]!.snapshotId);

    // slot 1 equals the live state now → no-op, no rotation
    const before = final.slots[0]!.snapshotId;
    const noop = await restoreBackup(coach, { seasonId: SEASON_ID, slot: 1 });
    expect(noop.noop).toBe(true);
    expect((await listBackups(SEASON_ID)).slots[0]!.snapshotId).toBe(before);
  });

  it("a stale slot reference is refused instead of restoring the wrong backup", async () => {
    const coach = await makeUser();
    await seedA(coach, ["2026-11-09"]);
    await publishAll(coach, TRACK_A);
    await backupNow(coach, { seasonId: SEASON_ID, scope: { seasonId: SEASON_ID, from: null, to: null, kinds: null } });
    const err = await restoreBackup(coach, { seasonId: SEASON_ID, slot: 1, expectedSnapshotId: uuid() }).catch((e) => e);
    expect(code(err)).toBe("slot_changed");
  });
});

describe("7 · scoped restore preserves everything outside its scope", () => {
  it("restores only November, keeps December, another season and private tracks, and the backup ignores later venue/library edits", async () => {
    const coach = await makeUser();
    const [nov, dec] = await seedA(coach, ["2026-11-09", "2026-12-07"]);
    await publishAll(coach, TRACK_A);
    await backupNow(coach, { seasonId: SEASON_ID, scope: { seasonId: SEASON_ID, from: "2026-11-01", to: "2026-11-30", kinds: null }, label: "November as posted" });

    // a different season with its own live event
    const S2 = uuid();
    const T2 = uuid();
    await getDb().insert(seasons).values({ id: S2, name: "Spring club", startDate: "2027-08-01", endDate: "2027-12-31" });
    await getDb().insert(tracks).values({ id: T2, seasonId: S2, name: "Track A" });
    const other = await createEvent(coach, practiceDoc({ date: "2027-09-01" }), { trackId: T2 });
    await publish(coach, { trackId: T2, mode: "selected", rowIds: [other.id] });

    // later: venue renamed + archived, library changed, November and December republished differently
    await getDb().update(locations).set({ name: "Renamed gym", archivedAt: sql`now()` }).where(eq(locations.id, CMS_ID));
    const d = await createDrill(coach, { title: "Drill v1" });
    await updateDrill(coach, d.id, { baseVersion: d.version, drill: { title: "Drill v2" } });
    const novRow = (await getEvent(nov.id))!;
    await saveAndPublish(coach, nov.id, { baseVersion: novRow.version, doc: { ...novRow, theme: "Nov v2", locationId: GL_ID } });
    const decRow = (await getEvent(dec.id))!;
    await saveAndPublish(coach, dec.id, { baseVersion: decRow.version, doc: { ...decRow, theme: "Dec v2" } });
    const { trackId: priv } = await createTrack(coach, { seasonId: SEASON_ID, name: "Private idea", mode: "empty" });
    await createEvent(coach, practiceDoc({ date: "2026-11-20", title: "private only" }), { trackId: priv });

    await restoreBackup(coach, { seasonId: SEASON_ID, slot: 1 });
    const n = (await getPublicEvent(nov.logicalId))!;
    expect(n.theme).toBe("Parry-riposte foundations");
    expect(n.location?.name).toBe("Columbia Middle School – Gold Gym"); // saved display, not the renamed venue
    expect((await getPublicEvent(dec.logicalId))!.theme).toBe("Dec v2"); // out of scope
    expect(await getPublicEvent(other.logicalId)).not.toBeNull(); // other season
    expect((await listTrackEvents(priv)).map((e) => e.title)).toEqual(["private only"]);
    expect((await getEvent(nov.id))!.theme).toBe("Nov v2"); // private work untouched
    expect((await getEvent(nov.id))!.publication).toBe("changed");
  });
});

describe("8 · imports into tracks: same keys, idempotency, re-import after clear, Trash collisions, UUID keys", () => {
  const file = {
    format: "gl-fencing-plan",
    version: 1,
    drills: [{ key: "ladder", title: "Ladder" }],
    events: [
      { key: "wk1-mon", date: "2026-11-09", theme: "Plan A", blocks: [{ lane: "shared", drill: "ladder", duration: 150 }] },
      { key: "wk1-wed", date: "2026-11-11", theme: "Plan A" },
    ],
  };

  it("keeps A and B independent, re-imports idempotently, and handles clear → re-import → restore collisions", async () => {
    const coach = await makeUser();
    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "empty" });
    const ra = await runImport(coach, file, { dryRun: false, trackId: TRACK_A });
    expect(ra.target).toMatchObject({ trackId: TRACK_A, trackName: "Track A" });
    const rb = await runImport(coach, { ...file, events: file.events.map((e) => ({ ...e, theme: "Plan B" })) }, { dryRun: false, trackId: B });
    expect(rb.identity.sharedWithOtherTracks).toBe(2); // same keys → same logical events (one public link each)
    const a = await listTrackEvents(TRACK_A);
    const b = await listTrackEvents(B);
    expect(a.map((e) => e.theme)).toEqual(["Plan A", "Plan A"]);
    expect(b.map((e) => e.theme)).toEqual(["Plan B", "Plan B"]);
    expect(b.map((e) => e.logicalId)).toEqual(a.map((e) => e.logicalId));
    expect(await listDrills()).toEqual([]); // drills are track-only by default

    const again = await runImport(coach, file, { dryRun: false, trackId: TRACK_A });
    expect(again.counts.events).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(again.counts.drills).toMatchObject({ created: 0, updated: 0, unchanged: 1 });

    const { result } = await clear(coach, TRACK_A, "track", null, { includeResources: true });
    const re = await runImport(coach, file, { dryRun: false, trackId: TRACK_A });
    expect(re.ok).toBe(true);
    expect(re.counts.events.created).toBe(2);
    expect(re.identity.reusedFromTrash).toBe(2);
    const fresh = await listTrackEvents(TRACK_A);
    expect(fresh.map((e) => e.logicalId)).toEqual(a.map((e) => e.logicalId));

    const err = await restoreFromTrash(coach, { seasonId: SEASON_ID, batchId: result.batchId! }).catch((e) => e);
    expect(code(err)).toBe("restore_conflict");
    expect((err as AppError).details).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ reason: "same-event" })]) });
    expect(await listTrackEvents(TRACK_A)).toHaveLength(2); // nothing half-restored

    const [first, second] = a;
    const ladder = (await listTrash(SEASON_ID)).drills[0];
    const ok = await restoreFromTrash(coach, {
      seasonId: SEASON_ID,
      batchId: result.batchId!,
      resolutions: { [first.id]: "copy", [second.id]: "replace", [ladder.id]: "skip" },
    });
    expect(ok.copies).toBe(1);
    expect(ok.replaced).toBe(1);
    const now = await listTrackEvents(TRACK_A);
    expect(now).toHaveLength(3);
    expect(new Set(now.map((e) => e.logicalId)).size).toBe(3);
    expect(await listTrackEvents(B)).toHaveLength(2);
  });

  it("UUID-shaped keys stay inside the target track and season", async () => {
    const coach = await makeUser();
    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "empty" });
    const bEv = await createEvent(coach, practiceDoc({ theme: "B original" }), { trackId: B });
    const S2 = uuid();
    const T2 = uuid();
    await getDb().insert(seasons).values({ id: S2, name: "Other", startDate: "2027-08-01", endDate: "2027-12-31" });
    await getDb().insert(tracks).values({ id: T2, seasonId: S2, name: "Track A" });
    const otherSeason = await createEvent(coach, practiceDoc({ theme: "other season" }), { trackId: T2 });

    const r = await runImport(
      coach,
      { format: "gl-fencing-plan", version: 1, events: [{ key: bEv.id, date: "2026-11-09", theme: "via row id" }, { key: otherSeason.logicalId, date: "2026-11-10", theme: "via other season" }] },
      { dryRun: false, trackId: TRACK_A },
    );
    expect(r.ok).toBe(true);
    expect(r.counts.events.created).toBe(2);
    expect((await getEvent(bEv.id))!.theme).toBe("B original");
    expect((await getEvent(otherSeason.id))!.theme).toBe("other season");
    const a = await listTrackEvents(TRACK_A);
    expect(a.some((e) => e.logicalId === otherSeason.logicalId)).toBe(false);
    // a key equal to a logical id of THIS season links the variant to that identity
    const r2 = await runImport(coach, { format: "gl-fencing-plan", version: 1, events: [{ key: bEv.logicalId, date: "2026-11-09", theme: "A variant" }] }, { dryRun: false, trackId: TRACK_A });
    expect(r2.counts.events.created).toBe(1);
    expect((await listTrackEvents(TRACK_A)).some((e) => e.logicalId === bEv.logicalId)).toBe(true);
  });

  it("an import with errors saves nothing (no partial plan) and dry runs never touch the public schedule", async () => {
    const coach = await makeUser();
    const bad = await runImport(coach, { format: "gl-fencing-plan", version: 1, events: [{ key: "ok", date: "2026-11-09" }, { key: "ok", date: "2026-11-10" }] }, { dryRun: false, trackId: TRACK_A });
    expect(bad.ok).toBe(false);
    expect(await listTrackEvents(TRACK_A)).toHaveLength(0);
    const shared = await runImport(coach, { ...file }, { dryRun: true, trackId: TRACK_A, updateShared: true });
    expect(shared.sharedChanges.some((c) => c.includes("Added shared drill"))).toBe(true);
    expect(await listDrills()).toEqual([]);
    expect(await allPublic()).toEqual([]);
  });
});

describe("9 · stale tracks and concurrency", () => {
  it("stops B's stale replacement when another coach changed a live meet after B's baseline, then reconciles explicitly", async () => {
    const coach1 = await makeUser("coach", "c1@example.org");
    const coach2 = await makeUser("coach", "c2@example.org");
    const meet = await createEvent(coach1, practiceDoc({ date: "2026-12-16", kind: "meet", title: "Meet", startTime: "16:00", endTime: "19:00", blocks: [], meet: { opponent: "Rival", homeAway: "away", reportTime: "15:00", busDepart: "14:45", busReturn: null, address: "", details: "" } }), { trackId: TRACK_A });
    await publishAll(coach1, TRACK_A);
    const { trackId: B } = await createTrack(coach1, { seasonId: SEASON_ID, name: "Track B", mode: "duplicate", sourceTrackId: TRACK_A });
    const bMeet = (await listTrackEvents(B))[0];
    await saveEvent(coach1, bMeet.id, { baseVersion: bMeet.version, doc: { ...bMeet, announcement: "B's note" } });

    // coach 2 changes the live meet from Track A (bus time) after B's baseline
    const aMeet = (await getEvent(meet.id))!;
    await saveAndPublish(coach2, meet.id, { baseVersion: aMeet.version, doc: { ...aMeet, meet: { ...aMeet.meet!, busDepart: "14:15" } } });

    const review = await reviewPublication(B, { mode: "replace", scope: null });
    expect(review.counts.conflicts).toBe(1);
    expect(review.items[0].conflict?.type).toBe("live-changed");
    const err = await publish(coach1, { trackId: B, mode: "replace", scope: null, token: review.token }).catch((e) => e);
    expect(code(err)).toBe("live_conflict");
    expect((await getPublicEvent(meet.logicalId))!.meet?.busDepart).toBe("14:15"); // newer change kept

    // explicit reconcile: take the live version into B (B keeps its private notes)
    await publish(coach1, { trackId: B, mode: "replace", scope: null, token: review.token, resolutions: { [meet.logicalId]: "take-live" } });
    const reconciled = (await listTrackEvents(B))[0];
    expect(reconciled.meet?.busDepart).toBe("14:15");
    expect(reconciled.announcement).toBe("Bring water."); // B's unpublished note replaced by the live text
    expect(reconciled.publication).toBe("published");
    expect(reconciled.live.changedSinceBaseline).toBe(false);
  });

  it("concurrent publish and restore serialize; concurrent duplicate clears run once", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach, ["2026-11-09"]);
    await publishAll(coach, TRACK_A);
    await backupNow(coach, { seasonId: SEASON_ID, scope: { seasonId: SEASON_ID, from: null, to: null, kinds: null } });
    const row = (await getEvent(ev.id))!;
    await saveEvent(coach, ev.id, { baseVersion: row.version, doc: { ...row, theme: "v2" } });
    const genBefore = (await getDb().select().from(seasons).where(eq(seasons.id, SEASON_ID)))[0].liveGeneration;
    const results = await Promise.allSettled([
      publish(coach, { trackId: TRACK_A, mode: "selected", rowIds: [ev.id], resolutions: { [ev.logicalId]: "overwrite" } }),
      restoreBackup(coach, { seasonId: SEASON_ID, slot: 1 }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const genAfter = (await getDb().select().from(seasons).where(eq(seasons.id, SEASON_ID)))[0].liveGeneration;
    expect(genAfter).toBeGreaterThan(genBefore);
    expect(await allPublic()).toHaveLength(1);

    const preview = await previewClear({ trackId: TRACK_A, target: "both", scope: null });
    const op = uuid();
    const [c1, c2] = await Promise.all([
      executeClear(coach, { trackId: TRACK_A, target: "both", scope: null, token: preview.token, operationId: op, slot: 2 }),
      executeClear(coach, { trackId: TRACK_A, target: "both", scope: null, token: preview.token, operationId: op, slot: 2 }),
    ]);
    expect([c1.replayed, c2.replayed].filter(Boolean)).toHaveLength(1);
    expect((await listTrash(SEASON_ID)).batches).toHaveLength(1);
  });

  it("a delayed autosave after a clear+restore is rejected; restore never rewinds versions", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach, ["2026-11-09"]);
    const { result } = await clear(coach, TRACK_A, "track", null);
    await restoreFromTrash(coach, { seasonId: SEASON_ID, batchId: result.batchId! });
    const now = (await getEvent(ev.id))!;
    expect(now.version).toBe(ev.version + 2);
    await expect(saveEvent(coach, ev.id, { baseVersion: ev.version, doc: practiceDoc({ theme: "stale" }) })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("10 · old Trash and purge permissions", () => {
  it("shows items deleted more than 90 days ago and lets only administrators purge them", async () => {
    const coach = await makeUser();
    const admin = await makeUser("admin");
    const [ev] = await seedA(coach, ["2026-11-09"]);
    await deleteEvent(coach, ev.id);
    await getDb().update(events).set({ deletedAt: sql`now() - interval '200 days'` }).where(eq(events.id, ev.id));
    const trash = await listTrash(SEASON_ID);
    expect(trash.events.map((e) => e.id)).toEqual([ev.id]);
    expect(trash.events[0].ageDays).toBeGreaterThanOrEqual(200);
    await expect(previewPurge(coach, { scope: "items", events: [ev.id] })).rejects.toMatchObject({ code: "forbidden" });
    const p = await previewPurge(admin, { scope: "items", events: [ev.id] });
    expect(p.total).toBe(1);
    await expect(purgeTrash(admin, { scope: "items", events: [ev.id], expectedCount: 2 })).rejects.toMatchObject({ code: "count_changed" });
    await purgeTrash(admin, { scope: "items", events: [ev.id], expectedCount: 1 });
    expect((await listTrash(SEASON_ID)).events).toHaveLength(0);
  });
});

describe("11 · in-season editing still works and stays inside its track", () => {
  it("publishes a cancellation only, keeps per-track edits separate, and refuses edits to a removed track", async () => {
    const coach = await makeUser();
    const [ev] = await seedA(coach, ["2026-11-09"]);
    await publishAll(coach, TRACK_A);
    const { trackId: B } = await createTrack(coach, { seasonId: SEASON_ID, name: "Track B", mode: "duplicate", sourceTrackId: TRACK_A });
    const draft = await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: `draft ${SECRET}` } });
    await setCanceled(coach, ev.id, { canceled: true, reason: "Snow day", publish: true, baseVersion: draft.version });
    const pub = (await getPublicEvent(ev.logicalId))!;
    expect(pub.status).toBe("canceled");
    expect(pub.theme).toBe("Parry-riposte foundations");
    const bRow = (await listTrackEvents(B))[0];
    expect(bRow.status).toBe("scheduled"); // B's working copy is its own
    expect(bRow.live.changedSinceBaseline).toBe(true); // …but B can see live changed
    await createTrack(coach, { seasonId: SEASON_ID, name: "Track C", mode: "empty" });
    await removeTrack(coach, B);
    await expect(saveEvent(coach, bRow.id, { baseVersion: bRow.version, doc: { ...bRow, theme: "x" } })).rejects.toMatchObject({ code: "track_removed" });
  });
});

describe("Quick logistics update (snow reschedule)", () => {
  it("publishes only the reviewed logistics fields, keeps unfinished plan edits private, and can be undone", async () => {
    const coach = await makeUser();
    const other = await makeUser("coach", "other@example.org");
    const [ev] = await seedA(coach, ["2026-12-07"]);
    await publishAll(coach, TRACK_A);
    const row = (await getEvent(ev.id))!;
    await saveEvent(coach, ev.id, { baseVersion: row.version, doc: { ...row, theme: `Unfinished ${SECRET}`, blocks: row.blocks.slice(0, 3) } });

    const live = await getLiveLogistics(ev.logicalId);
    expect(live.values).toMatchObject({ date: "2026-12-07", startTime: "15:30", endTime: "18:00", locationId: CMS_ID });
    const res = await publishLogistics(coach, {
      logicalId: ev.logicalId,
      trackId: TRACK_A,
      basedOn: { generation: live.generation, values: live.values },
      values: { ...live.values, date: "2026-12-08", startTime: "16:00", endTime: "18:30" },
      note: "Snow: moved to Tuesday 4:00",
    });
    expect(res.fields.sort()).toEqual(["date", "endTime", "startTime"]);
    const pub = (await getPublicEvent(ev.logicalId))!;
    expect(pub).toMatchObject({ date: "2026-12-08", startTime: "16:00", endTime: "18:30", theme: "Parry-riposte foundations" });
    expect(pub.blocks).toHaveLength(11); // draft plan edits not published
    expect(pub.notice?.text).toBe("Snow: moved to Tuesday 4:00");
    expect(JSON.stringify(pub)).not.toContain(SECRET);
    const working = (await getEvent(ev.id))!;
    expect(working).toMatchObject({ date: "2026-12-08", startTime: "16:00", endTime: "18:30" }); // reconciled
    expect(working.theme).toContain("Unfinished"); // other edits kept
    expect(working.blocks).toHaveLength(3);

    // a second coach working from the old values conflicts on the same field
    const err = await publishLogistics(other, { logicalId: ev.logicalId, basedOn: { generation: live.generation, values: live.values }, values: { ...live.values, startTime: "17:00" } }).catch((e) => e);
    expect(code(err)).toBe("logistics_conflict");
    // …but an unrelated field (venue) still goes through on top of the current live values
    await publishLogistics(other, { logicalId: ev.logicalId, basedOn: { generation: live.generation, values: live.values }, values: { ...live.values, locationId: GL_ID, venue: "x" } });
    expect((await getPublicEvent(ev.logicalId))!).toMatchObject({ date: "2026-12-08", startTime: "16:00", location: { shortName: "GL Red Gym" } });

    const history = await listPublications(ev.logicalId);
    const patch = history.find((h) => h.action === "logistics" && h.notice === "Snow: moved to Tuesday 4:00")!;
    expect(patch.canUndo).toBe(true);
    await undoLogistics(coach, { publicationId: patch.id, trackId: TRACK_A });
    const undone = (await getPublicEvent(ev.logicalId))!;
    expect(undone).toMatchObject({ date: "2026-12-07", startTime: "15:30", endTime: "18:00", location: { shortName: "GL Red Gym" } });
    expect(undone.notice?.text).toMatch(/undone/i);
    expect((await getEvent(ev.id))!.date).toBe("2026-12-07");

    // a later ordinary publish that changes logistics drops the stale notice
    const w = (await getEvent(ev.id))!;
    await saveAndPublish(coach, ev.id, { baseVersion: w.version, doc: { ...w, theme: "Final", startTime: "15:45", endTime: "18:15" }, resolutions: { [ev.logicalId]: "overwrite" } });
    expect((await getPublicEvent(ev.logicalId))!.notice ?? null).toBeNull();
  });
});

describe("public isolation of new private data", () => {
  it("track names, backup labels and track phases never appear in public tables", async () => {
    const coach = await makeUser();
    const { trackId } = await createTrack(coach, { seasonId: SEASON_ID, name: "Secret Track Name", mode: "empty" });
    const ev = await createEvent(coach, practiceDoc(), { trackId });
    await createPhase(coach, { seasonId: SEASON_ID, trackId, name: "Unpublished phase", startDate: "2026-11-01", endDate: "2026-11-30" });
    await publish(coach, { trackId, mode: "selected", rowIds: [ev.id] });
    await backupNow(coach, { seasonId: SEASON_ID, scope: { seasonId: SEASON_ID, from: null, to: null, kinds: null }, label: "Secret backup label" });
    const dump = JSON.stringify((await getDb().execute(sql`SELECT payload::text AS p FROM public_events`)).rows);
    expect(dump).not.toContain("Secret Track Name");
    expect(dump).not.toContain(SECRET);
    expect(await getPhasesInRange("2026-11-01", "2026-11-30")).toEqual([]);
    const meta = JSON.stringify(await getPublicMeta());
    expect(meta).not.toContain("Secret");
    const [slot] = await getDb().select().from(backupSlots).where(and(eq(backupSlots.seasonId, SEASON_ID), eq(backupSlots.slot, 1)));
    expect(slot.label).toBe("Secret backup label");
    void publicEvents;
  });
});
