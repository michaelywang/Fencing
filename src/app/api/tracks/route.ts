import { apiRoute, readJson } from "@/server/http";
import { listWorkspaces } from "@/server/services/scope";
import { createTrack, type TrackMode } from "@/server/services/tracks";
import { badRequest } from "@/server/errors";
import { optUuid, slotInput, str, uuidOrThrow, type Body } from "@/server/apiInput";

/** Seasons with their planning tracks (coach-only: track names and descriptions are private). */
export const GET = apiRoute("coach", async () => ({ workspaces: await listWorkspaces() }));

export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  const mode = body.mode as TrackMode;
  if (!["empty", "duplicate", "published", "backup"].includes(mode)) throw badRequest("Choose how to create the track.");
  return createTrack(user, {
    seasonId: uuidOrThrow(body.seasonId, "season"),
    name: str(body.name, 60),
    description: str(body.description),
    mode,
    sourceTrackId: optUuid(body.sourceTrackId),
    slot: slotInput(body.slot),
    operationId: str(body.operationId, 64) || null,
  });
});
