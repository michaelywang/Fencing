import { apiRoute, readJson } from "@/server/http";
import { reviewPublication } from "@/server/services/publishing";
import { bool, idList, scopeInput, uuidOrThrow, type Body } from "@/server/apiInput";

/** Read-only before/after summary of a publication or replacement (nothing changes). */
export const POST = apiRoute("coach", async ({ req }) => {
  const body = await readJson<Body>(req);
  return {
    review: await reviewPublication(uuidOrThrow(body.trackId, "track"), {
      mode: body.mode === "replace" ? "replace" : "selected",
      rowIds: idList(body.rowIds),
      removeLogicalIds: idList(body.removeLogicalIds),
      scope: scopeInput(body.scope),
      includePhases: bool(body.includePhases),
    }),
  };
});
