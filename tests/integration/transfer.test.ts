import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runImport, exportAll } from "@/server/services/transfer";
import { listEvents as listEventsSvc, getEvent } from "@/server/services/events";
import { publish } from "@/server/services/publishing";
import { listDrills } from "@/server/services/library";
import { getPublicEvent } from "@/server/services/public";
import { icsToImport } from "@/lib/ics";
import { analyzePractice } from "@/lib/timeline";
import { makeUser, resetDb, SECRET, TRACK_A } from "./helpers";
import type { SessionUser } from "@/server/auth/sessions";

const listEvents = (r: { from: string; to: string }) => listEventsSvc({ trackId: TRACK_A, ...r });
const publishEvents = (actor: SessionUser, ids: string[]) => publish(actor, { trackId: TRACK_A, mode: "selected", rowIds: ids });

beforeEach(resetDb);
const example = JSON.parse(fs.readFileSync(path.resolve("public/examples/gl-fencing-import-example.json"), "utf8"));

describe("import format", () => {
  it("dry-runs the example file without saving anything", async () => {
    const coach = await makeUser();
    const report = await runImport(coach, example, { dryRun: true, trackId: TRACK_A });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.counts.events.created).toBe(3);
    expect(report.counts.drills.created).toBe(3);
    expect(report.warnings.filter((w) => !w.includes("location"))).toEqual([]);
    expect(await listEvents({ from: "2026-12-01", to: "2026-12-31" })).toEqual([]);
    expect(await listDrills()).toEqual([]);
  });

  it("imports drafts with correctly auto-sequenced 150-minute plans and drill snapshots", async () => {
    const coach = await makeUser();
    const report = await runImport(coach, example, { dryRun: false, trackId: TRACK_A });
    expect(report.ok).toBe(true);
    const events = await listEvents({ from: "2026-12-01", to: "2026-12-31" });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.publication === "draft")).toBe(true);
    for (const e of events.filter((x) => x.kind === "practice")) {
      const t = analyzePractice(e.blocks, e.targetMinutes);
      expect(t.ok).toBe(true);
      expect(e.startTime).toBe("15:30"); // default start applied
      expect(e.endTime).toBe("18:00");
    }
    const first = events[0];
    expect(first.locationId).not.toBeNull(); // "CMS Gold Gym" matched by short name
    const parry = first.blocks.find((b) => b.title.includes("Parry 4"))!;
    expect(parry.source?.drillId).toBeTruthy();
    expect(parry.cues).toEqual(["Small parry", "Don't pull back"]);
    const meet = events.find((e) => e.kind === "meet")!;
    expect(meet.meet?.busDepart).toBe("14:45");
    expect(meet.locationNote).toContain("Example High School");
    expect(meet.confirmation).toBe("tentative");
  });

  it("re-importing the same keys updates instead of duplicating", async () => {
    const coach = await makeUser();
    await runImport(coach, example, { dryRun: false, trackId: TRACK_A });
    const again = await runImport(coach, example, { dryRun: false, trackId: TRACK_A });
    expect(again.counts.events.created).toBe(0);
    expect(again.counts.drills.created).toBe(0);
    expect(again.counts.events.updated).toBe(0); // identical content → no change
    const changed = structuredClone(example);
    changed.events[0].theme = "Updated theme";
    const third = await runImport(coach, changed, { dryRun: false, trackId: TRACK_A });
    expect(third.counts.events.updated).toBe(1);
    expect(await listEvents({ from: "2026-12-01", to: "2026-12-31" })).toHaveLength(3);
  });

  it("an import on a published event becomes an unpublished draft change", async () => {
    const coach = await makeUser();
    await runImport(coach, example, { dryRun: false, trackId: TRACK_A });
    const [first] = await listEvents({ from: "2026-12-07", to: "2026-12-07" });
    await publishEvents(coach, [first.id]);
    const changed = structuredClone(example);
    changed.events[0].theme = "Imported revision";
    await runImport(coach, changed, { dryRun: false, trackId: TRACK_A });
    expect((await getEvent(first.id))?.publication).toBe("changed");
    expect((await getPublicEvent(first.logicalId))?.theme).toBe("Distance and parry-riposte");
  });

  it("rejects invalid files with readable errors and saves nothing", async () => {
    const coach = await makeUser();
    const bad = await runImport(coach, { format: "gl-fencing-plan", version: 1, events: [{ date: "2026-13-01" }] }, { dryRun: false, trackId: TRACK_A });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/events\.0\.date/);
    const wrongFormat = await runImport(coach, { hello: "world" }, { dryRun: true, trackId: TRACK_A });
    expect(wrongFormat.ok).toBe(false);
  });

  it("exports everything (admin) in the same format without credentials", async () => {
    const admin = await makeUser("admin", "boss@example.org");
    await runImport(admin, { ...example, events: [{ ...example.events[0], privateNotes: SECRET }] }, { dryRun: false, trackId: TRACK_A });
    const data = await exportAll();
    const json = JSON.stringify(data);
    expect(data.format).toBe("gl-fencing-plan");
    expect(data.events).toHaveLength(1);
    expect(json).toContain(SECRET); // private export includes private notes…
    expect(json).not.toMatch(/password|scrypt\$|token/i); // …but never credentials
    // The export can be re-imported as-is.
    const round = await runImport(admin, data, { dryRun: true, trackId: TRACK_A });
    expect(round.errors).toEqual([]);
  });
});

describe("iCalendar import", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:meet-1@example.org",
    "SUMMARY:Fencing @ Example HS",
    "DTSTART;TZID=America/New_York:20261216T160000",
    "DTEND;TZID=America/New_York:20261216T190000",
    "LOCATION:Example HS\\, 1 Example Rd",
    "DESCRIPTION:Bring cords\\nBus at 2:45",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:tourney-1@example.org",
    "SUMMARY:District Championships",
    "DTSTART:20270110T130000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:allday@example.org",
    "SUMMARY:No school - holiday",
    "DTSTART;VALUE=DATE:20261224",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("converts events into the team's local time and guesses kinds", () => {
    const r = icsToImport(ics, { timezone: "America/New_York" });
    expect(r.count).toBe(3);
    const [meet, holiday, tourney] = r.data.events as Array<Record<string, unknown>>;
    expect(meet).toMatchObject({ kind: "meet", date: "2026-12-16", start: "16:00", end: "19:00", confirmation: "tentative" });
    expect(meet.meet).toMatchObject({ opponent: "Example HS", homeAway: "away" });
    expect(holiday).toMatchObject({ kind: "holiday", date: "2026-12-24", start: null });
    expect(tourney).toMatchObject({ kind: "tournament", date: "2027-01-10", start: "08:00" }); // 13:00Z = 8:00 EST
  });

  it("feeds straight into the importer", async () => {
    const coach = await makeUser();
    const r = icsToImport(ics, { timezone: "America/New_York" });
    const report = await runImport(coach, r.data, { dryRun: false, trackId: TRACK_A });
    expect(report.ok).toBe(true);
    expect(report.counts.events.created).toBe(3);
  });
});

describe("portability", () => {
  it("an export imported into a fresh installation can be re-imported without duplicates", async () => {
    const admin = await makeUser("admin", "admin@example.org");
    await runImport(admin, example, { dryRun: false, trackId: TRACK_A });
    const exported = await exportAll();
    await resetDb(); // simulate a brand-new installation
    const admin2 = await makeUser("admin", "admin2@example.org");
    const first = await runImport(admin2, exported, { dryRun: false, trackId: TRACK_A });
    expect(first.counts.events.created).toBe(3);
    const second = await runImport(admin2, exported, { dryRun: false, trackId: TRACK_A });
    expect(second.counts.events.created).toBe(0);
    expect(await listEvents({ from: "2026-12-01", to: "2026-12-31" })).toHaveLength(3);
  });
});
