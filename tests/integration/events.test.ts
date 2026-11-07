import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  createEvent,
  deleteEvent,
  discardDraftChanges,
  duplicateEvent,
  duplicateWeek,
  getEvent,
  listRevisions,
  moveEvent,
  publishEvents,
  restoreRevision,
  saveAndPublish,
  saveEvent,
  setCanceled,
  undeleteEvent,
  unpublishEvent,
} from "@/server/services/events";
import { getNextUp, getPublicEvent, getPublicEvents, getPublicMeta } from "@/server/services/public";
import { ConflictError } from "@/server/errors";
import { analyzePractice } from "@/lib/timeline";
import { zonedTimeToUtc } from "@/lib/dates";
import { makeUser, practiceDoc, resetDb, SECRET } from "./helpers";

beforeEach(resetDb);

describe("drafts and publishing", () => {
  it("new practices are private drafts until published", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    expect(ev.publication).toBe("draft");
    expect(ev.version).toBe(1);
    expect(await getPublicEvent(ev.id)).toBeNull();
    expect(await getPublicEvents("2026-11-01", "2026-11-30")).toEqual([]);

    await publishEvents(coach, [ev.id], { note: "Week 1 posted" });
    const pub = await getPublicEvent(ev.id);
    expect(pub?.theme).toBe("Parry-riposte foundations");
    expect(JSON.stringify(pub)).not.toContain(SECRET);
    expect((await getEvent(ev.id))?.publication).toBe("published");
    const meta = await getPublicMeta();
    expect(meta.lastNote).toBe("Week 1 posted");
    expect(meta.lastUpdatedAt).not.toBeNull();
  });

  it("editing a published practice as a draft leaves the public version unchanged until publication", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);

    const saved = await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: "Distance games (draft)" } });
    expect(saved.publication).toBe("changed");
    expect((await getPublicEvent(ev.id))?.theme).toBe("Parry-riposte foundations");

    await publishEvents(coach, [ev.id], { expectedVersions: { [ev.id]: saved.version } });
    expect((await getPublicEvent(ev.id))?.theme).toBe("Distance games (draft)");
    expect((await getEvent(ev.id))?.publication).toBe("published");
  });

  it("save & publish updates the public version in one step", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);
    const after = await saveAndPublish(coach, ev.id, { baseVersion: (await getEvent(ev.id))!.version, doc: { ...practiceDoc(), announcement: "Bus at 2:45" } });
    expect(after.publication).toBe("published");
    expect((await getPublicEvent(ev.id))?.announcement).toBe("Bus at 2:45");
  });

  it("discarding draft changes returns the working copy to the published version", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);
    const changed = await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: "Oops" } });
    const discarded = await discardDraftChanges(coach, ev.id, changed.version);
    expect(discarded.theme).toBe("Parry-riposte foundations");
    expect(discarded.publication).toBe("published");
  });

  it("unpublish removes the event from the public calendar", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);
    await unpublishEvent(coach, ev.id);
    expect(await getPublicEvent(ev.id)).toBeNull();
    expect((await getEvent(ev.id))?.publication).toBe("draft");
  });

  it("publishing cancellation keeps other unpublished edits private", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);
    const draft = await saveEvent(coach, ev.id, { baseVersion: ev.version, doc: { ...practiceDoc(), theme: "Unfinished idea" } });
    await setCanceled(coach, ev.id, { canceled: true, reason: "Gym unavailable", publish: true, baseVersion: draft.version });
    const pub = await getPublicEvent(ev.id);
    expect(pub?.status).toBe("canceled");
    expect(pub?.cancelReason).toBe("Gym unavailable");
    expect(pub?.theme).toBe("Parry-riposte foundations"); // draft theme NOT leaked
    const working = await getEvent(ev.id);
    expect(working?.status).toBe("canceled");
    expect(working?.theme).toBe("Unfinished idea");
    expect(working?.publication).toBe("changed");
    // Canceled events remain visible publicly (as canceled) but are not "next up".
    const { next } = await getNextUp("America/New_York", new Date("2026-11-08T15:00:00Z"));
    expect(next).toBeNull();
  });
});

describe("optimistic concurrency", () => {
  it("rejects a stale save instead of silently overwriting another coach", async () => {
    const a = await makeUser("coach", "a@example.org");
    const b = await makeUser("coach", "b@example.net");
    const ev = await createEvent(a, practiceDoc());
    await saveEvent(a, ev.id, { baseVersion: 1, doc: { ...practiceDoc(), theme: "Coach A's change" } });
    const err = await saveEvent(b, ev.id, { baseVersion: 1, doc: { ...practiceDoc(), theme: "Coach B's change" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const current = (err as ConflictError).details as { current: { theme: string; version: number; updatedByName: string } };
    expect(current.current.theme).toBe("Coach A's change");
    expect(current.current.updatedByName).toBe("coach user");
    expect((await getEvent(ev.id))?.theme).toBe("Coach A's change");
    // B can deliberately overwrite by using the current version.
    const overwritten = await saveEvent(b, ev.id, { baseVersion: current.current.version, doc: { ...practiceDoc(), theme: "Coach B's change" } });
    expect(overwritten.theme).toBe("Coach B's change");
  });

  it("checks versions when publishing what was reviewed", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await saveEvent(coach, ev.id, { baseVersion: 1, doc: { ...practiceDoc(), theme: "v2" } });
    await expect(publishEvents(coach, [ev.id], { expectedVersions: { [ev.id]: 1 } })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("history, restore and deletion", () => {
  it("records revisions with authors and restores a previous version", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    const v2 = await saveEvent(coach, ev.id, { baseVersion: 1, doc: { ...practiceDoc(), theme: "Accidental change", blocks: [] } });
    const revs = await listRevisions(ev.id);
    expect(revs.map((r) => r.action)).toEqual(["edit", "create"]);
    expect(revs[0].userName).toBe("coach user");
    const original = revs.find((r) => r.action === "create")!;
    const restored = await restoreRevision(coach, ev.id, original.id, v2.version);
    expect(restored.theme).toBe("Parry-riposte foundations");
    expect(restored.blocks).toHaveLength(11);
    expect((await listRevisions(ev.id))[0].action).toBe("restore");
  });

  it("coalesces rapid autosaves by the same coach into one revision", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    let v = 1;
    for (const theme of ["a", "ab", "abc"]) {
      v = (await saveEvent(coach, ev.id, { baseVersion: v, doc: { ...practiceDoc(), theme } })).version;
    }
    const revs = await listRevisions(ev.id);
    expect(revs.filter((r) => r.action === "edit")).toHaveLength(1);
    expect(v).toBe(4);
  });

  it("soft-deletes with undo, restoring the public version too", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    await publishEvents(coach, [ev.id]);
    await deleteEvent(coach, ev.id);
    expect(await getEvent(ev.id)).toBeNull();
    expect(await getPublicEvent(ev.id)).toBeNull();
    const back = await undeleteEvent(coach, ev.id);
    expect(back.publication).toBe("published");
    expect((await getPublicEvent(ev.id))?.title).toBe("Practice");
  });
});

describe("dates, daylight saving and duplication", () => {
  it("moving across the DST change keeps the local 3:30 PM start", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc({ date: "2026-10-30" })); // EDT
    const moved = await moveEvent(coach, ev.id, { baseVersion: 1, date: "2026-11-02" }); // EST
    expect(moved.date).toBe("2026-11-02");
    expect(moved.startTime).toBe("15:30");
    expect(zonedTimeToUtc(ev.date, ev.startTime!, ev.timezone).toISOString()).toBe("2026-10-30T19:30:00.000Z");
    expect(zonedTimeToUtc(moved.date, moved.startTime!, moved.timezone).toISOString()).toBe("2026-11-02T20:30:00.000Z");
  });

  it("duplicates a practice to new dates without private notes or coaches unless asked", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc({ date: "2026-10-26" }));
    const [plainId] = await duplicateEvent(coach, ev.id, { dates: ["2026-11-02"] });
    const plain = (await getEvent(plainId))!;
    expect(plain.startTime).toBe("15:30");
    expect(plain.endTime).toBe("18:00");
    expect(plain.publication).toBe("draft");
    expect(plain.privateNotes).toBe("");
    expect(plain.coachAssignments.foil).toBe("");
    expect(JSON.stringify(plain)).not.toContain(SECRET);
    expect(new Set(plain.blocks.map((b) => b.id)).size).toBe(11);
    expect(plain.blocks.some((b) => ev.blocks.some((o) => o.id === b.id))).toBe(false);

    const [fullId] = await duplicateEvent(coach, ev.id, { dates: ["2026-11-03"], copyCoaches: true, copyNotes: true });
    const full = (await getEvent(fullId))!;
    expect(full.privateNotes).toContain(SECRET);
    expect(full.coachAssignments.foil).toBe("Coach A");
  });

  it("duplicates an entire week with shifted dates and identical local times across DST", async () => {
    const coach = await makeUser();
    for (const date of ["2026-10-26", "2026-10-27", "2026-10-29"]) await createEvent(coach, practiceDoc({ date }));
    await createEvent(coach, practiceDoc({ date: "2026-10-31", kind: "meet", startTime: "09:00", endTime: "14:00", blocks: [] }));
    const ids = await duplicateWeek(coach, { sourceWeekStart: "2026-10-26", targetWeekStart: "2026-11-02" });
    expect(ids).toHaveLength(4);
    const copies = await Promise.all(ids.map((id) => getEvent(id)));
    expect(copies.map((c) => c!.date).sort()).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-07"]);
    const meet = copies.find((c) => c!.kind === "meet")!;
    expect(meet.startTime).toBe("09:00");
    expect(zonedTimeToUtc(meet.date, meet.startTime!, meet.timezone).toISOString()).toBe("2026-11-07T14:00:00.000Z");
  });
});

describe("timing of stored practices", () => {
  it("the stored helper practice is exactly 150 minutes for each weapon", async () => {
    const coach = await makeUser();
    const ev = await createEvent(coach, practiceDoc());
    const t = analyzePractice(ev.blocks, ev.targetMinutes);
    expect(t.ok).toBe(true);
    expect([t.perWeapon.foil.coveredMinutes, t.perWeapon.epee.coveredMinutes, t.perWeapon.saber.coveredMinutes]).toEqual([150, 150, 150]);
  });
});

describe("public read model isolation", () => {
  it("public tables never contain private notes or draft-only events", async () => {
    const coach = await makeUser();
    const pub = await createEvent(coach, practiceDoc());
    await createEvent(coach, practiceDoc({ date: "2026-11-10", title: "Secret draft" }));
    await publishEvents(coach, [pub.id]);
    const dump = await getDb().execute(sql`SELECT payload::text AS p FROM public_events`);
    const all = dump.rows.map((r) => String((r as { p: string }).p)).join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("Secret draft");
    expect(all).not.toContain("privateNotes");
  });
});
