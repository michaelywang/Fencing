import { apiRoute, readJson } from "@/server/http";
import { publishPhases } from "@/server/services/publishing";
import { scopeInput, str, uuidOrThrow, type Body } from "@/server/apiInput";

/** Publish this track's phases (replacing the published phases in the scope; whole season by default). */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  return publishPhases(user, { trackId: uuidOrThrow(body.trackId, "track"), scope: scopeInput(body.scope), note: str(body.note, 280), operationId: str(body.operationId, 64) || null });
});
