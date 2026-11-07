/**
 * Database schema (PostgreSQL, managed with Drizzle migrations in /drizzle).
 *
 * Privacy layout:
 *   events          — private working copies (drafts, private notes). Coach-only.
 *   event_revisions — full snapshots for history/restore. Coach-only.
 *   public_events   — sanitized public projections. The ONLY event table that
 *                     public pages and public API routes read.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { EventDoc, DrillDetails, TemplateDoc } from "@/lib/schemas";
import type { PublicEvent } from "@/lib/projection";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Accounts & authentication
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(), // stored lower-cased
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "coach"] }).notNull().default("coach"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastLoginAt: ts("last_login_at"),
    passwordChangedAt: ts("password_changed_at"),
    disabledAt: ts("disabled_at"),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email), check("users_email_lower", sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 (hex) of the random session token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    userAgent: text("user_agent").notNull().default(""),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Single-use invite and password-reset tokens (hashed). */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["invite", "reset"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "coach"] }),
    name: text("name").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("auth_tokens_hash_unique").on(t.tokenHash), index("auth_tokens_email_idx").on(t.email)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: createdAt(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);

// ---------------------------------------------------------------------------
// Team configuration
// ---------------------------------------------------------------------------
export const teamSettings = pgTable(
  "team_settings",
  {
    id: integer("id").primaryKey().default(1),
    teamName: text("team_name").notNull().default("Governor Livingston Fencing"),
    shortName: text("short_name").notNull().default("GL Fencing"),
    timezone: text("timezone").notNull().default("America/New_York"),
    defaultPracticeMinutes: integer("default_practice_minutes").notNull().default(150),
    defaultPracticeStart: text("default_practice_start").notNull().default("15:30"),
    defaultPracticeLocationId: uuid("default_practice_location_id"),
    defaultMeetLocationId: uuid("default_meet_location_id"),
    publicIntro: text("public_intro").notNull().default(""),
    showCoachNamesPublicly: boolean("show_coach_names_publicly").notNull().default(true),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [check("team_settings_singleton", sql`${t.id} = 1`)],
);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  address: text("address").notNull().default(""),
  kind: text("kind", { enum: ["practice", "meet", "both", "away"] }).notNull().default("both"),
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts("archived_at"),
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull().default(""),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Training phases are public (shown on the season overview). */
export const phases = pgTable(
  "phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    focus: text("focus").notNull().default(""),
    color: text("color").notNull().default("sky"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("phases_season_idx").on(t.seasonId)],
);

// ---------------------------------------------------------------------------
// Events (private working copies)
// ---------------------------------------------------------------------------
export type EventContent = Omit<
  EventDoc,
  "kind" | "date" | "startTime" | "endTime" | "title" | "confirmation" | "status" | "locationId" | "privateNotes" | "completedNotes"
>;

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["practice", "meet", "tournament", "recovery", "holiday", "other"] }).notNull(),
    /** Local calendar date in `timezone`. */
    date: date("date", { mode: "string" }).notNull(),
    /** Local wall-clock times "HH:MM" in `timezone` (null = all day). */
    startTime: text("start_time"),
    endTime: text("end_time"),
    timezone: text("timezone").notNull().default("America/New_York"),
    title: text("title").notNull().default(""),
    confirmation: text("confirmation", { enum: ["confirmed", "tentative"] }).notNull().default("confirmed"),
    status: text("status", { enum: ["scheduled", "canceled"] }).notNull().default("scheduled"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    content: jsonb("content").$type<EventContent>().notNull(),
    privateNotes: text("private_notes").notNull().default(""),
    completedNotes: text("completed_notes").notNull().default(""),
    /** Optimistic-concurrency counter; incremented on every saved change. */
    version: integer("version").notNull().default(1),
    /** Working-copy version that is currently public (null = not published). */
    publishedVersion: integer("published_version"),
    publishedAt: ts("published_at"),
    externalRef: text("external_ref"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    /** Public projection that was live when the event was deleted (restored on undelete). */
    deletedPublicPayload: jsonb("deleted_public_payload").$type<PublicEvent | null>(),
  },
  (t) => [
    index("events_date_idx").on(t.date),
    uniqueIndex("events_external_ref_unique").on(t.externalRef),
    check("events_start_time_fmt", sql`${t.startTime} IS NULL OR ${t.startTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
    check("events_end_time_fmt", sql`${t.endTime} IS NULL OR ${t.endTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
  ],
);

export const eventRevisions = pgTable(
  "event_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull().default(""),
    snapshot: jsonb("snapshot").$type<EventDoc>().notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("event_revisions_event_idx").on(t.eventId, t.createdAt)],
);

/** Sanitized public projections. Public routes read ONLY this table for events. */
export const publicEvents = pgTable(
  "public_events",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    startTime: text("start_time"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<PublicEvent>().notNull(),
    sourceVersion: integer("source_version").notNull(),
    publishedAt: ts("published_at").notNull().defaultNow(),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("public_events_date_idx").on(t.date)],
);

/** Each publish/unpublish/cancel; the latest note is shown on the public site. */
export const publishLog = pgTable(
  "publish_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    note: text("note").notNull().default(""),
    eventCount: integer("event_count").notNull().default(0),
  },
  (t) => [index("publish_log_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Drill library & templates (coach-only)
// ---------------------------------------------------------------------------
export const drills = pgTable(
  "drills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    weapons: text("weapons").array().notNull().default(sql`'{}'::text[]`),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    level: text("level", { enum: ["beginner", "intermediate", "experienced", "all"] }).notNull().default("all"),
    durationMin: integer("duration_min"),
    equipment: text("equipment").array().notNull().default(sql`'{}'::text[]`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    category: text("category").notNull().default("technical"),
    details: jsonb("details").$type<DrillDetails>().notNull(),
    coachNotes: text("coach_notes").notNull().default(""),
    externalRef: text("external_ref"),
    version: integer("version").notNull().default(1),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("drills_external_ref_unique").on(t.externalRef)],
);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  doc: jsonb("doc").$type<TemplateDoc>().notNull(),
  externalRef: text("external_ref"),
  version: integer("version").notNull().default(1),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts("deleted_at"),
});
