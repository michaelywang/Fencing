import { apiRoute, readJson } from "@/server/http";
import { runImport } from "@/server/services/transfer";
import { bool, uuidOrThrow, type Body } from "@/server/apiInput";

/**
 * Import the JSON planning format (see docs/IMPORT_FORMAT.md) INTO ONE TRACK.
 * `dryRun: true` (default) validates and reports without saving. Shared drills,
 * templates, venues and season dates change only with `updateShared: true`.
 * Imports never change the public schedule.
 */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req, 5_000_000);
  return runImport(user, body.data, { dryRun: body.dryRun !== false, trackId: uuidOrThrow(body.trackId, "track"), updateShared: bool(body.updateShared) });
});
