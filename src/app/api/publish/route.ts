import { apiRoute, readJson } from "@/server/http";
import { publish } from "@/server/services/publishing";
import { badRequest } from "@/server/errors";
import { bool, idList, publishResolutions, scopeInput, slotInput, str, uuidOrThrow, versionMap, type Body } from "@/server/apiInput";

/**
 * Publish from a track. mode "selected": the given events (+ explicit removals).
 * mode "replace": make the public schedule match the track for a reviewed scope
 * (requires the review token; a backup is taken first).
 */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  const mode = body.mode === "replace" ? "replace" : body.mode === "selected" || body.mode === undefined ? "selected" : null;
  if (!mode) throw badRequest("Unknown publication mode.");
  return publish(user, {
    trackId: uuidOrThrow(body.trackId, "track"),
    mode,
    rowIds: idList(body.rowIds ?? body.ids),
    removeLogicalIds: idList(body.removeLogicalIds),
    scope: scopeInput(body.scope),
    includePhases: bool(body.includePhases),
    token: str(body.token, 80) || null,
    resolutions: publishResolutions(body.resolutions),
    expectedVersions: versionMap(body.expectedVersions),
    note: str(body.note, 280),
    slot: slotInput(body.slot),
    operationId: str(body.operationId, 64) || null,
  });
});
