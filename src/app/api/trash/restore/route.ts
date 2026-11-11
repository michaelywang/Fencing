import { apiRoute, readJson } from "@/server/http";
import { restoreFromTrash } from "@/server/services/trash";
import { bool, idList, optUuid, restoreResolutions, str, uuidOrThrow, type Body } from "@/server/apiInput";

/** Restore one item, selected items, or a whole clear batch (atomic). Drafts unless `publicRestore` is chosen. */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  return restoreFromTrash(user, {
    seasonId: uuidOrThrow(body.seasonId, "season"),
    batchId: optUuid(body.batchId),
    events: idList(body.events),
    phases: idList(body.phases),
    drills: idList(body.drills),
    templates: idList(body.templates),
    tracks: idList(body.tracks),
    publicRestore: bool(body.publicRestore),
    resolutions: restoreResolutions(body.resolutions),
    operationId: str(body.operationId, 64) || null,
  });
});
