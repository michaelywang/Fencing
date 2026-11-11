import "server-only";
import { badRequest } from "@/server/errors";
import type { PurgeRequest } from "@/server/services/trash";
import { idList, optUuid, type Body } from "@/server/apiInput";

export function purgeInput(raw: unknown): PurgeRequest {
  const body = (raw ?? {}) as Body;
  const scope = body.scope;
  if (scope !== "items" && scope !== "batch" && scope !== "season" && scope !== "all") throw badRequest("Choose what to delete permanently.");
  return {
    scope,
    seasonId: optUuid(body.seasonId),
    trackId: optUuid(body.trackId),
    batchId: optUuid(body.batchId),
    events: idList(body.events),
    phases: idList(body.phases),
    drills: idList(body.drills),
    templates: idList(body.templates),
    tracks: idList(body.tracks),
  };
}
