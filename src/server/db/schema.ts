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
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { EventDoc, DrillDetails, TemplateDoc } from "@/lib/schemas";
import type { PublicEvent } from "@/lib/projection";
import type { BackupEventEntry, BackupMeta, BackupPhase, BackupSeasonDisplay, LiveScope } from "@/lib/liveTypes";

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

/**
 * A season is the planning WORKSPACE: it owns planning tracks, logical events,
 * one live public schedule (public_events + public_phases), and three backup slots.
 */
export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull().default(""),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Shown on the public Season page. Seasons created by the tracks migration start hidden. */
  publicVisible: boolean("public_visible").notNull().default(true),
  /** Monotonic counter, +1 for every operation that changes this season's live public schedule. */
  liveGeneration: integer("live_generation").notNull().default(0),
  liveUpdatedAt: ts("live_updated_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Saved planning tracks (Track A, B, C …). Shared by all coaches; the SELECTED track is per tab/URL. */
export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Internal, coach-only description. */
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Live generation this track last reconciled with, for logical events it has no specific baseline for. */
    baselineGeneration: integer("baseline_generation").notNull().default(0),
    origin: text("origin").notNull().default("empty"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("tracks_season_idx").on(t.seasonId),
    uniqueIndex("tracks_season_name_active").on(t.seasonId, sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`),
  ],
);

/**
 * Stable LOGICAL event identity. Its id is the public URL (/e/<id>). Each track
 * holds at most one active variant (events row) per logical event.
 */
export const logicalEvents = pgTable(
  "logical_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    /** Season live generation of this event's last live change (0 = never live). */
    liveGeneration: integer("live_generation").notNull().default(0),
    livePresent: boolean("live_present").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("logical_events_season_idx").on(t.seasonId)],
);

/** Track-specific (private) training phases. Published copies live in public_phases. */
export const phases = pgTable(
  "phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    focus: text("focus").notNull().default(""),
    color: text("color").notNull().default("sky"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
    clearBatchId: uuid("clear_batch_id"),
  },
  (t) => [index("phases_season_idx").on(t.seasonId), index("phases_track_idx").on(t.trackId)],
);

/** Published training phases (the only phases public pages read). */
export const publicPhases = pgTable(
  "public_phases",
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
    publishedAt: ts("published_at").notNull().defaultNow(),
  },
  (t) => [index("public_phases_season_idx").on(t.seasonId)],
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
    /** The planning track this working copy belongs to. */
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    /** Stable logical identity shared by the variants of one event across tracks (= public URL id). */
    logicalId: uuid("logical_id")
      .notNull()
      .references(() => logicalEvents.id, { onDelete: "cascade" }),
    /** Set when the row was moved to Trash by a bulk clear. */
    clearBatchId: uuid("clear_batch_id"),
  },
  (t) => [
    index("events_date_idx").on(t.date),
    index("events_track_date_idx").on(t.trackId, t.date),
    index("events_logical_idx").on(t.logicalId),
    uniqueIndex("events_track_logical_active").on(t.trackId, t.logicalId).where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("events_track_ref_active").on(t.trackId, t.externalRef).where(sql`${t.deletedAt} IS NULL AND ${t.externalRef} IS NOT NULL`),
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

/**
 * Sanitized public projections — the live schedule. Keyed by LOGICAL event id
 * (column name `event_id` kept for compatibility). Public routes read ONLY the
 * `payload` of this table for events. No foreign key to private rows, so
 * purging Trash can never remove live content.
 */
export const publicEvents = pgTable(
  "public_events",
  {
    logicalId: uuid("event_id")
      .primaryKey()
      .references(() => logicalEvents.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    startTime: text("start_time"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").$type<PublicEvent>().notNull(),
    sourceVersion: integer("source_version").notNull(),
    /** Private provenance (never selected by public routes). */
    sourceRowId: uuid("source_row_id"),
    sourceTrackId: uuid("source_track_id"),
    locationId: uuid("location_id"),
    changedGeneration: integer("changed_generation").notNull().default(0),
    publishedAt: ts("published_at").notNull().defaultNow(),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("public_events_date_idx").on(t.date), index("public_events_season_date_idx").on(t.seasonId, t.date)],
);

/** Per-track knowledge of the live schedule: the live generation each logical event was last reconciled at. */
export const trackBaselines = pgTable(
  "track_baselines",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    logicalId: uuid("logical_id")
      .notNull()
      .references(() => logicalEvents.id, { onDelete: "cascade" }),
    seenGeneration: integer("seen_generation").notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.logicalId] })],
);

/** Event-level publication provenance (private): what went live, from where, by whom. */
export const eventPublications = pgTable(
  "event_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    logicalId: uuid("logical_id")
      .notNull()
      .references(() => logicalEvents.id, { onDelete: "cascade" }),
    sourceRowId: uuid("source_row_id"),
    sourceTrackId: uuid("source_track_id"),
    action: text("action").notNull(),
    generation: integer("generation").notNull(),
    /** Private working copy that was published (null for removals and backup restores). */
    snapshot: jsonb("snapshot").$type<EventDoc | null>(),
    previousPayload: jsonb("previous_payload").$type<PublicEvent | null>(),
    payload: jsonb("payload").$type<PublicEvent | null>(),
    operationId: uuid("operation_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("event_publications_logical_idx").on(t.logicalId, t.createdAt)],
);

/** Immutable, self-contained, schema-versioned snapshots of a published schedule scope. */
export const backupSnapshots = pgTable(
  "backup_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull().default(1),
    reason: text("reason").notNull(),
    scope: jsonb("scope").$type<LiveScope>().notNull(),
    dateFrom: date("date_from", { mode: "string" }),
    dateTo: date("date_to", { mode: "string" }),
    eventCount: integer("event_count").notNull(),
    events: jsonb("events").$type<BackupEventEntry[]>().notNull(),
    phases: jsonb("phases").$type<BackupPhase[] | null>(),
    season: jsonb("season").$type<BackupSeasonDisplay>().notNull(),
    meta: jsonb("meta").$type<BackupMeta>().notNull(),
    contentHash: text("content_hash").notNull(),
    operationId: uuid("operation_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("backup_snapshots_season_idx").on(t.seasonId)],
);

/** Three backup slots per season, each pointing at an immutable snapshot. Swaps only move pointers. */
export const backupSlots = pgTable(
  "backup_slots",
  {
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => backupSnapshots.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.slot] }), check("backup_slots_range", sql`${t.slot} BETWEEN 1 AND 3`)],
);

/** One bulk "clear schedule" action (for Trash grouping and batch restore). */
export const clearBatches = pgTable(
  "clear_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    target: text("target").notNull(),
    scope: jsonb("scope").$type<LiveScope>().notNull(),
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
    items: jsonb("items").$type<{ events: string[]; phases: string[]; drills: string[]; templates: string[] }>().notNull(),
    backupSnapshotId: uuid("backup_snapshot_id").references(() => backupSnapshots.id, { onDelete: "set null" }),
    operationId: uuid("operation_id"),
    createdAt: createdAt(),
  },
  (t) => [index("clear_batches_season_idx").on(t.seasonId, t.createdAt)],
);

/** Idempotency records for bulk operations (client-supplied operation ids). */
export const operations = pgTable("operations", {
  id: uuid("id").primaryKey(),
  kind: text("kind").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  seasonId: uuid("season_id"),
  result: jsonb("result").$type<unknown>(),
  createdAt: createdAt(),
});

/** Each live operation; the most recent entry's public note is shown on the public site. */
export const publishLog = pgTable(
  "publish_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    note: text("note").notNull().default(""),
    eventCount: integer("event_count").notNull().default(0),
    seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),
    operationId: uuid("operation_id"),
    /** Private operation summary (counts, scope) for the coach activity log. */
    details: jsonb("details").$type<Record<string, unknown>>(),
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
    /** null = shared library; otherwise a track-local variant. */
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
    clearBatchId: uuid("clear_batch_id"),
  },
  (t) => [
    uniqueIndex("drills_scope_ref_active")
      .on(sql`coalesce(${t.trackId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.externalRef)
      .where(sql`${t.deletedAt} IS NULL AND ${t.externalRef} IS NOT NULL`),
  ],
);

export const templates = pgTable(
  "templates",
  {
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
    /** null = shared template; otherwise a track-local variant. */
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
    clearBatchId: uuid("clear_batch_id"),
  },
  (t) => [
    uniqueIndex("templates_scope_ref_active")
      .on(sql`coalesce(${t.trackId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.externalRef)
      .where(sql`${t.deletedAt} IS NULL AND ${t.externalRef} IS NOT NULL`),
  ],
);
