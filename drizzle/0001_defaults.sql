-- Default team settings row and the two primary GL facilities.
-- Facilities can be renamed/edited (addresses added) in Admin → Locations.
INSERT INTO "team_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "locations" ("id", "name", "short_name", "kind", "sort_order", "notes")
VALUES
  ('8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b01', 'Columbia Middle School – Gold Gym', 'CMS Gold Gym', 'practice', 1, 'Primary practice facility.'),
  ('8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b02', 'Governor Livingston High School – Red Gym', 'GL Red Gym', 'meet', 2, 'Primary home meet facility.')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "team_settings"
SET "default_practice_location_id" = '8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b01',
    "default_meet_location_id" = '8d0c6a2e-5b1f-4f57-9a3c-0f3c8a1e2b02'
WHERE "id" = 1 AND "default_practice_location_id" IS NULL AND "default_meet_location_id" IS NULL;
