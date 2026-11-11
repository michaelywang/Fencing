CREATE TABLE "backup_slots" (
	"season_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"label" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "backup_slots_season_id_slot_pk" PRIMARY KEY("season_id","slot"),
	CONSTRAINT "backup_slots_range" CHECK ("backup_slots"."slot" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "backup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"scope" jsonb NOT NULL,
	"date_from" date,
	"date_to" date,
	"event_count" integer NOT NULL,
	"events" jsonb NOT NULL,
	"phases" jsonb,
	"season" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"operation_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clear_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"track_id" uuid,
	"user_id" uuid,
	"target" text NOT NULL,
	"scope" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"backup_snapshot_id" uuid,
	"operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"logical_id" uuid NOT NULL,
	"source_row_id" uuid,
	"source_track_id" uuid,
	"action" text NOT NULL,
	"generation" integer NOT NULL,
	"snapshot" jsonb,
	"previous_payload" jsonb,
	"payload" jsonb,
	"operation_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"live_generation" integer DEFAULT 0 NOT NULL,
	"live_present" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"season_id" uuid,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"focus" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'sky' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_baselines" (
	"track_id" uuid NOT NULL,
	"logical_id" uuid NOT NULL,
	"seen_generation" integer NOT NULL,
	CONSTRAINT "track_baselines_track_id_logical_id_pk" PRIMARY KEY("track_id","logical_id")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"baseline_generation" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'empty' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "public_events" DROP CONSTRAINT "public_events_event_id_events_id_fk";
--> statement-breakpoint
DROP INDEX "drills_external_ref_unique";--> statement-breakpoint
DROP INDEX "events_external_ref_unique";--> statement-breakpoint
ALTER TABLE "drills" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "drills" ADD COLUMN "clear_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "logical_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "clear_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "phases" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "phases" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phases" ADD COLUMN "clear_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "public_events" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "public_events" ADD COLUMN "source_row_id" uuid;--> statement-breakpoint
ALTER TABLE "public_events" ADD COLUMN "source_track_id" uuid;--> statement-breakpoint
ALTER TABLE "public_events" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "public_events" ADD COLUMN "changed_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_log" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_log" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_log" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "public_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "live_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "live_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "clear_batch_id" uuid;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- DATA MIGRATION: introduce planning tracks and logical event identity.
--  * Every existing event row keeps its id; that id becomes its LOGICAL id, so
--    public URLs (/e/<id>), coach URLs and published payloads are unchanged.
--  * Every event is assigned explicitly to a season (events never had one):
--      demo events  -> the demo season (if present);
--      other events -> the earliest non-demo season whose dates contain them,
--                      else the nearest non-demo season (its dates unchanged),
--                      else a new, publicly hidden "Main season".
--    Nothing is discarded, and no visible season dates change.
--  * Each season gets "Track A" holding all its existing rows (incl. Trash).
--  * Existing phases become Track A phases AND are copied to public_phases
--    (they were public before, so public output is unchanged).
--  * Live generation 1 is the migrated live state; Track A is reconciled with it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  demo_season uuid;
  main_season uuid;
  acad_start date;
  acad_end date;
BEGIN
  acad_start := make_date(CASE WHEN extract(month FROM now()) >= 7 THEN extract(year FROM now())::int ELSE extract(year FROM now())::int - 1 END, 8, 1);
  acad_end := (acad_start + interval '1 year' - interval '1 day')::date;

  CREATE TEMP TABLE _event_season (event_id uuid PRIMARY KEY, season_id uuid NOT NULL) ON COMMIT DROP;

  SELECT id INTO demo_season FROM seasons WHERE is_demo ORDER BY start_date LIMIT 1;
  IF demo_season IS NOT NULL THEN
    INSERT INTO _event_season SELECT id, demo_season FROM events WHERE is_demo;
  END IF;

  INSERT INTO _event_season
    SELECT e.id,
      (SELECT s.id FROM seasons s WHERE NOT s.is_demo AND e.date BETWEEN s.start_date AND s.end_date ORDER BY s.start_date, s.created_at LIMIT 1)
    FROM events e
    WHERE NOT EXISTS (SELECT 1 FROM _event_season x WHERE x.event_id = e.id)
      AND EXISTS (SELECT 1 FROM seasons s WHERE NOT s.is_demo AND e.date BETWEEN s.start_date AND s.end_date);

  IF EXISTS (SELECT 1 FROM events e WHERE NOT EXISTS (SELECT 1 FROM _event_season x WHERE x.event_id = e.id)) THEN
    IF EXISTS (SELECT 1 FROM seasons WHERE NOT is_demo) THEN
      INSERT INTO _event_season
        SELECT e.id,
          (SELECT s.id FROM seasons s WHERE NOT s.is_demo
            ORDER BY LEAST(abs(e.date - s.start_date), abs(e.date - s.end_date)), s.start_date LIMIT 1)
        FROM events e
        WHERE NOT EXISTS (SELECT 1 FROM _event_season x WHERE x.event_id = e.id);
    ELSE
      INSERT INTO seasons (name, start_date, end_date, notes, public_visible)
        SELECT 'Main season', LEAST(min(e.date), acad_start), GREATEST(max(e.date), acad_end),
               'Created automatically when planning tracks were introduced. Rename it and adjust its dates as needed.', false
        FROM events e
        WHERE NOT EXISTS (SELECT 1 FROM _event_season x WHERE x.event_id = e.id)
        RETURNING id INTO main_season;
      INSERT INTO _event_season
        SELECT e.id, main_season FROM events e WHERE NOT EXISTS (SELECT 1 FROM _event_season x WHERE x.event_id = e.id);
    END IF;
  END IF;

  -- Fresh installations get one workspace so the planner works immediately.
  IF NOT EXISTS (SELECT 1 FROM seasons) THEN
    INSERT INTO seasons (name, start_date, end_date, notes, public_visible)
      VALUES (to_char(acad_start, 'YYYY') || '–' || to_char(acad_end, 'YY') || ' Season', acad_start, acad_end, '', true);
  END IF;

  -- Live generation 1 = the state at migration time, for seasons with published events.
  UPDATE seasons s SET
    live_generation = CASE WHEN EXISTS (SELECT 1 FROM public_events pe JOIN _event_season es ON es.event_id = pe.event_id WHERE es.season_id = s.id) THEN 1 ELSE 0 END,
    live_updated_at = (SELECT max(pe.published_at) FROM public_events pe JOIN _event_season es ON es.event_id = pe.event_id WHERE es.season_id = s.id);

  INSERT INTO tracks (season_id, name, sort_order, baseline_generation, origin, is_demo)
    SELECT s.id, 'Track A', 0, s.live_generation, 'migrated', s.is_demo FROM seasons s;

  INSERT INTO logical_events (id, season_id, live_generation, live_present, created_at)
    SELECT e.id, es.season_id,
           CASE WHEN pe.event_id IS NULL THEN 0 ELSE 1 END,
           pe.event_id IS NOT NULL,
           e.created_at
    FROM events e
    JOIN _event_season es ON es.event_id = e.id
    LEFT JOIN public_events pe ON pe.event_id = e.id;

  UPDATE events e SET
    logical_id = e.id,
    track_id = (SELECT t.id FROM tracks t WHERE t.season_id = es.season_id ORDER BY t.sort_order LIMIT 1)
  FROM _event_season es WHERE es.event_id = e.id;

  UPDATE public_events pe SET
    season_id = es.season_id,
    source_row_id = pe.event_id,
    source_track_id = e.track_id,
    changed_generation = 1,
    location_id = (SELECT l.id FROM locations l WHERE l.name = pe.payload->'location'->>'name' ORDER BY l.archived_at NULLS FIRST, l.created_at LIMIT 1)
  FROM _event_season es, events e
  WHERE es.event_id = pe.event_id AND e.id = pe.event_id;

  INSERT INTO track_baselines (track_id, logical_id, seen_generation)
    SELECT e.track_id, pe.event_id, 1 FROM public_events pe JOIN events e ON e.id = pe.event_id;

  INSERT INTO event_publications (season_id, logical_id, source_row_id, source_track_id, action, generation, snapshot, payload, created_at)
    SELECT pe.season_id, pe.event_id, pe.event_id, pe.source_track_id, 'migrated', 1,
      (SELECT r.snapshot FROM event_revisions r WHERE r.event_id = pe.event_id AND r.action = 'publish' ORDER BY r.created_at DESC LIMIT 1),
      pe.payload, pe.published_at
    FROM public_events pe;

  UPDATE phases p SET track_id = (SELECT t.id FROM tracks t WHERE t.season_id = p.season_id ORDER BY t.sort_order LIMIT 1);

  INSERT INTO public_phases (season_id, name, start_date, end_date, focus, color, published_at)
    SELECT p.season_id, p.name, p.start_date, p.end_date, p.focus, p.color, p.updated_at FROM phases p;
END $$;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "track_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "logical_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phases" ALTER COLUMN "track_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_events" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_slots" ADD CONSTRAINT "backup_slots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_slots" ADD CONSTRAINT "backup_slots_snapshot_id_backup_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."backup_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_slots" ADD CONSTRAINT "backup_slots_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_snapshots" ADD CONSTRAINT "backup_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_snapshots" ADD CONSTRAINT "backup_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clear_batches" ADD CONSTRAINT "clear_batches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clear_batches" ADD CONSTRAINT "clear_batches_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clear_batches" ADD CONSTRAINT "clear_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clear_batches" ADD CONSTRAINT "clear_batches_backup_snapshot_id_backup_snapshots_id_fk" FOREIGN KEY ("backup_snapshot_id") REFERENCES "public"."backup_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_publications" ADD CONSTRAINT "event_publications_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_publications" ADD CONSTRAINT "event_publications_logical_id_logical_events_id_fk" FOREIGN KEY ("logical_id") REFERENCES "public"."logical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_publications" ADD CONSTRAINT "event_publications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_events" ADD CONSTRAINT "logical_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_phases" ADD CONSTRAINT "public_phases_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_baselines" ADD CONSTRAINT "track_baselines_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_baselines" ADD CONSTRAINT "track_baselines_logical_id_logical_events_id_fk" FOREIGN KEY ("logical_id") REFERENCES "public"."logical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_snapshots_season_idx" ON "backup_snapshots" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "clear_batches_season_idx" ON "clear_batches" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE INDEX "event_publications_logical_idx" ON "event_publications" USING btree ("logical_id","created_at");--> statement-breakpoint
CREATE INDEX "logical_events_season_idx" ON "logical_events" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "public_phases_season_idx" ON "public_phases" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "tracks_season_idx" ON "tracks" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_season_name_active" ON "tracks" USING btree ("season_id",lower("name")) WHERE "tracks"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "drills" ADD CONSTRAINT "drills_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_logical_id_logical_events_id_fk" FOREIGN KEY ("logical_id") REFERENCES "public"."logical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_events" ADD CONSTRAINT "public_events_event_id_logical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."logical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_events" ADD CONSTRAINT "public_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_log" ADD CONSTRAINT "publish_log_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drills_scope_ref_active" ON "drills" USING btree (coalesce("track_id", '00000000-0000-0000-0000-000000000000'::uuid),"external_ref") WHERE "drills"."deleted_at" IS NULL AND "drills"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_track_date_idx" ON "events" USING btree ("track_id","date");--> statement-breakpoint
CREATE INDEX "events_logical_idx" ON "events" USING btree ("logical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_track_logical_active" ON "events" USING btree ("track_id","logical_id") WHERE "events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_track_ref_active" ON "events" USING btree ("track_id","external_ref") WHERE "events"."deleted_at" IS NULL AND "events"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "phases_track_idx" ON "phases" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "public_events_season_date_idx" ON "public_events" USING btree ("season_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_scope_ref_active" ON "templates" USING btree (coalesce("track_id", '00000000-0000-0000-0000-000000000000'::uuid),"external_ref") WHERE "templates"."deleted_at" IS NULL AND "templates"."external_ref" IS NOT NULL;