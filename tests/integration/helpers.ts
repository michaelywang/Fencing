import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { seasons, tracks, users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/crypto";
import type { SessionUser } from "@/server/auth/sessions";

export const CMS_ID = "8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b01";
export const GL_ID = "8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b02";
export const SECRET = "PRIVATE-MARKER-c0ffee";

export const SEASON_ID = "8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2c01";
export const TRACK_A = "8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2d0a";

/**
 * Empties all data tables (children before parents is irrelevant with CASCADE,
 * but every table is listed so none is forgotten), then restores the default
 * settings/locations rows and one season ("2026–27 Season") with Track A.
 */
export async function resetDb() {
  const db = getDb();
  await db.execute(sql`TRUNCATE users, sessions, auth_tokens, rate_limits, audit_log, operations, clear_batches, backup_slots,
    backup_snapshots, event_publications, track_baselines, public_events, public_phases, event_revisions, events,
    logical_events, phases, tracks, publish_log, drills, templates, seasons, locations, team_settings RESTART IDENTITY CASCADE`);
  await db.execute(sql`INSERT INTO team_settings (id, default_practice_location_id, default_meet_location_id) VALUES (1, ${CMS_ID}, ${GL_ID})`);
  await db.execute(sql`INSERT INTO locations (id, name, short_name, kind, sort_order) VALUES
    (${CMS_ID}, 'Columbia Middle School – Gold Gym', 'CMS Gold Gym', 'practice', 1),
    (${GL_ID}, 'Governor Livingston High School – Red Gym', 'GL Red Gym', 'meet', 2)`);
  await db.insert(seasons).values({ id: SEASON_ID, name: "2026–27 Season", startDate: "2026-08-01", endDate: "2027-07-31" });
  await db.insert(tracks).values({ id: TRACK_A, seasonId: SEASON_ID, name: "Track A", origin: "empty" });
}

let hashCache: string | null = null;
export async function makeUser(role: "admin" | "coach" = "coach", email?: string, password = "correct horse battery"): Promise<SessionUser> {
  hashCache ??= await hashPassword("correct horse battery");
  const passwordHash = password === "correct horse battery" ? hashCache : await hashPassword(password);
  const [u] = await getDb()
    .insert(users)
    .values({ email: email ?? `${role}-${Math.random().toString(36).slice(2)}@example.org`, name: `${role} user`, role, passwordHash })
    .returning();
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** A complete, correctly timed 150-minute practice document. */
export function practiceDoc(overrides: Record<string, unknown> = {}) {
  return {
    kind: "practice",
    date: "2026-11-09",
    startTime: "15:30",
    endTime: "18:00",
    title: "Practice",
    theme: "Parry-riposte foundations",
    intensity: 3,
    targetMinutes: 150,
    locationId: CMS_ID,
    announcement: "Bring water.",
    privateNotes: `${SECRET} lineup thoughts`,
    completedNotes: "",
    coachAssignments: { shared: "Coach A", foil: "Coach A", epee: "Coach B", saber: "Coach C" },
    blocks: [
      { id: "warm", scope: "shared", start: 0, duration: 15, category: "warmup", title: "Dynamic warm-up" },
      { id: "fw", scope: "shared", start: 15, duration: 20, category: "footwork", title: "Footwork ladder", privateNotes: `${SECRET} watch knee` },
      { id: "f1", scope: "weapon", weapons: ["foil"], start: 35, duration: 40, category: "technical", title: "Parry 4 riposte", coach: "Coach A" },
      { id: "e1", scope: "weapon", weapons: ["epee"], start: 35, duration: 40, category: "technical", title: "Point control" },
      { id: "s1", scope: "weapon", weapons: ["saber"], start: 35, duration: 40, category: "technical", title: "Attack in prep" },
      { id: "brk", scope: "shared", start: 75, duration: 10, category: "break", title: "Water break" },
      { id: "f2", scope: "weapon", weapons: ["foil"], start: 85, duration: 50, category: "bouting", title: "Foil bouting" },
      { id: "e2", scope: "weapon", weapons: ["epee"], start: 85, duration: 50, category: "bouting", title: "Épée bouting" },
      { id: "s2", scope: "weapon", weapons: ["saber"], start: 85, duration: 50, category: "bouting", title: "Saber bouting" },
      { id: "close", scope: "shared", start: 135, duration: 10, category: "closing", title: "Closing circle" },
      { id: "eq", scope: "shared", start: 145, duration: 5, category: "equipment", title: "Equipment return" },
    ],
    ...overrides,
  };
}
