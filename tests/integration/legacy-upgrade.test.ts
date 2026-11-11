/**
 * Scenario 12 — a realistic, populated database from the previous release
 * (migrations 0000 + 0001 only) upgrades through 0002 without changing public
 * output, URLs, unpublished edits, history, imports, the library or Trash.
 * Runs against its own throwaway databases (names contain "test").
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb } from "@/server/db";
import { toPublicEvent } from "@/lib/projection";
import { eventDocSchema, type EventDoc } from "@/lib/schemas";
import { getEvent, listRevisions, listTrackEvents, saveEvent } from "@/server/services/events";
import { publish } from "@/server/services/publishing";
import { getPhasesInRange, getPublicEvent, getPublicEvents, getPublicMeta, getPublicSeasons } from "@/server/services/public";
import { listWorkspaces } from "@/server/services/scope";
import { listTrash } from "@/server/services/trash";
import { listDrills } from "@/server/services/library";
import { CMS_ID, practiceDoc, SECRET } from "./helpers";

const BASE = process.env.TEST_DATABASE_URL ?? "postgres://fencing:fencing@localhost:5432/fencing_test";
const ORIGINAL_URL = process.env.DATABASE_URL;
const withDb = (name: string) => {
  const u = new URL(BASE);
  u.pathname = `/${name}`;
  return u.toString();
};

async function recreate(name: string) {
  const admin = new Pool({ connectionString: BASE, max: 1 });
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

/** A migrations folder containing only the first `count` migrations (the previous release). */
function legacyMigrations(count: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glf-legacy-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, count);
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.resolve(`drizzle/${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

function columns(doc: EventDoc) {
  const { kind, date, startTime, endTime, title, confirmation, status, locationId, privateNotes, completedNotes, ...content } = doc;
  return { kind, date, startTime, endTime, title, confirmation, status, locationId, privateNotes, completedNotes, content };
}

const IDS = {
  user: "11111111-1111-4111-8111-111111111111",
  season: "22222222-2222-4222-8222-222222222222",
  inSync: "33333333-3333-4333-8333-333333333301",
  edited: "33333333-3333-4333-8333-333333333302",
  outside: "33333333-3333-4333-8333-333333333303",
  trashed: "33333333-3333-4333-8333-333333333304",
  draft: "33333333-3333-4333-8333-333333333305",
};

async function insertEvent(pool: Pool, id: string, doc: EventDoc, opts: { version: number; publishedVersion: number | null; publishedDoc?: EventDoc; deleted?: boolean; externalRef?: string }) {
  const c = columns(doc);
  const location = { name: "Columbia Middle School – Gold Gym", shortName: "CMS Gold Gym", address: "" };
  const pubDoc = opts.publishedDoc ?? doc;
  const payload = opts.publishedVersion != null ? toPublicEvent(pubDoc, { id, timezone: "America/New_York", location: pubDoc.locationId ? location : null, showCoachNames: true, publishedAt: "2026-10-01T12:00:00.000Z" }) : null;
  await pool.query(
    `INSERT INTO events (id, kind, date, start_time, end_time, title, confirmation, status, location_id, content, private_notes, completed_notes,
       version, published_version, published_at, external_ref, created_by, updated_by, deleted_at, deleted_by, deleted_public_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$19,$20)`,
    [
      id, c.kind, c.date, c.startTime, c.endTime, c.title, c.confirmation, c.status, c.locationId, JSON.stringify(c.content), c.privateNotes, c.completedNotes,
      opts.version, opts.publishedVersion, payload ? payload.publishedAt : null, opts.externalRef ?? null, IDS.user,
      opts.deleted ? "2026-06-01T00:00:00Z" : null, opts.deleted ? IDS.user : null, opts.deleted && payload ? JSON.stringify(payload) : null,
    ],
  );
  await pool.query(`INSERT INTO event_revisions (event_id, version, action, summary, snapshot, user_id) VALUES ($1, 1, 'create', 'Created', $2, $3)`, [id, JSON.stringify(pubDoc), IDS.user]);
  if (payload && !opts.deleted) {
    await pool.query(`INSERT INTO event_revisions (event_id, version, action, summary, snapshot, user_id) VALUES ($1, $2, 'publish', 'Published', $3, $4)`, [id, opts.publishedVersion, JSON.stringify(pubDoc), IDS.user]);
    await pool.query(`INSERT INTO public_events (event_id, date, start_time, kind, status, payload, source_version, published_at, published_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      id, pubDoc.date, pubDoc.startTime, pubDoc.kind, pubDoc.status, JSON.stringify(payload), opts.publishedVersion, payload.publishedAt, IDS.user,
    ]);
  }
  if (opts.version > 1) await pool.query(`INSERT INTO event_revisions (event_id, version, action, summary, snapshot, user_id) VALUES ($1, $2, 'edit', 'theme', $3, $4)`, [id, opts.version, JSON.stringify(doc), IDS.user]);
}

afterAll(async () => {
  await closeDb();
  process.env.DATABASE_URL = ORIGINAL_URL;
});

describe("12 · legacy database upgrade", () => {
  it("upgrades a populated previous-release database without changing public output, URLs, edits, history or Trash", async () => {
    const name = "fencing_test_legacy_upgrade";
    await recreate(name);
    const url = withDb(name);
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: legacyMigrations(2) });
      await pool.query(`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, 'head@example.org', 'Head Coach', 'admin', 'x')`, [IDS.user]);
      await pool.query(`INSERT INTO seasons (id, name, start_date, end_date) VALUES ($1, '2026–27 Winter', '2026-09-01', '2027-03-15')`, [IDS.season]);
      await pool.query(`INSERT INTO phases (season_id, name, start_date, end_date, focus, color) VALUES ($1, 'Foundations', '2026-09-01', '2026-12-31', 'Footwork', 'sky')`, [IDS.season]);
      await pool.query(`INSERT INTO drills (title, external_ref, details) VALUES ('Legacy ladder', 'ladder', '{}'::jsonb)`);
      await pool.query(`INSERT INTO publish_log (user_id, action, note, event_count) VALUES ($1, 'publish', 'Week 1 posted', 2)`, [IDS.user]);
      const base = (o: Record<string, unknown>) => eventDocSchema.parse(practiceDoc(o));
      await insertEvent(pool, IDS.inSync, base({ date: "2026-11-09" }), { version: 1, publishedVersion: 1, externalRef: "import-key-1" });
      await insertEvent(pool, IDS.edited, base({ date: "2026-11-11", theme: `DRAFT EDIT ${SECRET}` }), { version: 2, publishedVersion: 1, publishedDoc: base({ date: "2026-11-11" }) });
      await insertEvent(pool, IDS.outside, base({ date: "2027-05-01", title: "After the season" }), { version: 1, publishedVersion: 1 });
      await insertEvent(pool, IDS.trashed, base({ date: "2026-11-13", title: "Deleted long ago" }), { version: 1, publishedVersion: 1, deleted: true });
      await insertEvent(pool, IDS.draft, base({ date: "2026-11-16", title: "Never published" }), { version: 1, publishedVersion: null });

      const before = (await pool.query(`SELECT event_id, payload FROM public_events ORDER BY event_id`)).rows;
      const revBefore = (await pool.query(`SELECT event_id, version, action, snapshot FROM event_revisions ORDER BY event_id, version, action`)).rows;

      // ---- the upgrade (what `npm run db:migrate` does on deploy)
      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const after = (await pool.query(`SELECT event_id, payload FROM public_events ORDER BY event_id`)).rows;
      expect(after).toEqual(before); // byte-for-byte public payloads, same ids (= /e/<id> links)
      const revAfter = (await pool.query(`SELECT event_id, version, action, snapshot FROM event_revisions ORDER BY event_id, version, action`)).rows;
      expect(revAfter).toEqual(revBefore);
      const ids = (await pool.query(`SELECT id, logical_id, track_id FROM events ORDER BY id`)).rows;
      expect(ids.every((r) => r.id === r.logical_id)).toBe(true);
      expect(new Set(ids.map((r) => r.track_id)).size).toBe(1);
    } finally {
      await pool.end();
    }

    // ---- the app, pointed at the upgraded database
    await closeDb();
    process.env.DATABASE_URL = url;
    const ws = await listWorkspaces();
    expect(ws).toHaveLength(1);
    expect(ws[0].tracks.map((t) => t.name)).toEqual(["Track A"]);
    const trackId = ws[0].tracks[0].id;
    expect((await getEvent(IDS.inSync))!.publication).toBe("published");
    const edited = (await getEvent(IDS.edited))!;
    expect(edited.publication).toBe("changed"); // unpublished edit preserved and still detected
    expect(edited.theme).toContain("DRAFT EDIT");
    expect((await getPublicEvent(IDS.edited))!.theme).toBe("Parry-riposte foundations");
    const outside = (await getEvent(IDS.outside))!;
    expect(outside.date).toBe("2027-05-01"); // not discarded, date unchanged
    expect(outside.trackId).toBe(trackId);
    expect((await getEvent(IDS.draft))!.publication).toBe("draft");
    expect((await listTrash(ws[0].id)).events.map((e) => e.id)).toEqual([IDS.trashed]);
    expect((await listRevisions(IDS.edited)).map((r) => r.action).sort()).toEqual(["create", "edit", "publish"]);
    expect((await getPhasesInRange("2026-09-01", "2026-12-31")).map((p) => p.name)).toEqual(["Foundations"]);
    expect((await getPublicSeasons()).map((s) => s.name)).toEqual(["2026–27 Winter"]);
    expect((await getPublicMeta()).lastNote).toBe("Week 1 posted");
    expect((await listDrills()).map((d) => d.title)).toEqual(["Legacy ladder"]);
    expect(await getPublicEvents("2026-09-01", "2027-06-30")).toHaveLength(3);
    expect((await listTrackEvents(trackId)).find((e) => e.id === IDS.inSync)!.externalRef).toBe("import-key-1");

    // the upgraded data keeps working: edit + publish the edited event, same public link
    const admin = { id: IDS.user, email: "head@example.org", name: "Head Coach", role: "admin" as const };
    await publish(admin, { trackId, mode: "selected", rowIds: [IDS.edited] });
    expect((await getPublicEvent(IDS.edited))!.theme).toContain("DRAFT EDIT");
    expect(JSON.stringify(await getPublicEvent(IDS.edited))).not.toContain("privateNotes");
    const saved = await saveEvent(admin, IDS.inSync, { baseVersion: 1, doc: { ...(await getEvent(IDS.inSync))!, theme: "post-upgrade" } });
    expect(saved.version).toBe(2);
    await closeDb();
    process.env.DATABASE_URL = ORIGINAL_URL;
  });

  it("puts events of a database without any season into a hidden 'Main season' and still serves them", async () => {
    const name = "fencing_test_legacy_noseason";
    await recreate(name);
    const url = withDb(name);
    const pool = new Pool({ connectionString: url, max: 2 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: legacyMigrations(2) });
      await pool.query(`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, 'head@example.org', 'Head Coach', 'admin', 'x')`, [IDS.user]);
      await insertEvent(pool, IDS.inSync, eventDocSchema.parse(practiceDoc({ date: "2026-11-09", locationId: CMS_ID })), { version: 1, publishedVersion: 1 });
      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });
      const s = (await pool.query(`SELECT name, public_visible, start_date::text, end_date::text FROM seasons`)).rows;
      expect(s).toHaveLength(1);
      expect(s[0].public_visible).toBe(false);
      expect(s[0].start_date <= "2026-11-09" && s[0].end_date >= "2026-11-09").toBe(true);
    } finally {
      await pool.end();
    }
    await closeDb();
    process.env.DATABASE_URL = url;
    expect((await getPublicEvent(IDS.inSync))!.date).toBe("2026-11-09");
    expect((await getEvent(IDS.inSync))!.publication).toBe("published");
    await closeDb();
    process.env.DATABASE_URL = ORIGINAL_URL;
  });
});
