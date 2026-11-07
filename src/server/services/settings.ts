import "server-only";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { locations, teamSettings } from "@/server/db/schema";
import { locationInputSchema, settingsInputSchema } from "@/lib/schemas";
import { isValidTimeZone } from "@/lib/dates";
import { badRequest, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/sessions";
import { audit } from "@/server/audit";
import { DEFAULT_PRACTICE_MINUTES, DEFAULT_PRACTICE_START, DEFAULT_TIMEZONE } from "@/lib/constants";

export type TeamSettings = typeof teamSettings.$inferSelect;
export type Location = typeof locations.$inferSelect;

const FALLBACK: TeamSettings = {
  id: 1,
  teamName: "Governor Livingston Fencing",
  shortName: "GL Fencing",
  timezone: DEFAULT_TIMEZONE,
  defaultPracticeMinutes: DEFAULT_PRACTICE_MINUTES,
  defaultPracticeStart: DEFAULT_PRACTICE_START,
  defaultPracticeLocationId: null,
  defaultMeetLocationId: null,
  publicIntro: "",
  showCoachNamesPublicly: true,
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
};

export async function getSettings(db: DbOrTx = getDb()): Promise<TeamSettings> {
  const [row] = await db.select().from(teamSettings).where(eq(teamSettings.id, 1)).limit(1);
  return row ?? FALLBACK;
}

export async function updateSettings(actor: SessionUser, input: unknown): Promise<TeamSettings> {
  const data = settingsInputSchema.parse(input);
  if (!isValidTimeZone(data.timezone)) throw badRequest("Unknown time zone. Use an IANA name such as America/New_York.");
  const db = getDb();
  await db
    .insert(teamSettings)
    .values({ id: 1, ...data, updatedBy: actor.id })
    .onConflictDoUpdate({ target: teamSettings.id, set: { ...data, updatedBy: actor.id, updatedAt: sql`now()` } });
  await audit(db, actor.id, "settings.updated", {});
  return getSettings(db);
}

export async function listLocations(opts: { includeArchived?: boolean } = {}, db: DbOrTx = getDb()): Promise<Location[]> {
  const q = db.select().from(locations);
  const rows = opts.includeArchived ? await q.orderBy(asc(locations.sortOrder), asc(locations.name)) : await q.where(isNull(locations.archivedAt)).orderBy(asc(locations.sortOrder), asc(locations.name));
  return rows;
}

export async function getLocation(id: string, db: DbOrTx = getDb()): Promise<Location | null> {
  const [row] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  return row ?? null;
}

export async function createLocation(actor: SessionUser, input: unknown): Promise<Location> {
  const data = locationInputSchema.parse(input);
  const db = getDb();
  const [row] = await db.insert(locations).values(data).returning();
  await audit(db, actor.id, "location.created", { id: row.id, name: row.name });
  return row;
}

export async function updateLocation(actor: SessionUser, id: string, input: unknown): Promise<Location> {
  const data = locationInputSchema.parse(input);
  const db = getDb();
  const [row] = await db.update(locations).set({ ...data, updatedAt: sql`now()` }).where(eq(locations.id, id)).returning();
  if (!row) throw notFound("Location not found.");
  return row;
}

export async function setLocationArchived(actor: SessionUser, id: string, archived: boolean): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(locations)
    .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(locations.id, id))
    .returning({ id: locations.id });
  if (!row) throw notFound("Location not found.");
  await audit(db, actor.id, archived ? "location.archived" : "location.restored", { id });
}
