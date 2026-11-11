import { apiRoute } from "@/server/http";
import { removeTrack, restoreTrack } from "@/server/services/tracks";
import { notFound } from "@/server/errors";

/** Remove (to Trash, reversible) or restore a track. The public schedule is never affected. */
export const POST = apiRoute<{ id: string; action: string }>("coach", async ({ user, params }) => {
  if (params.action === "remove") {
    await removeTrack(user, params.id);
    return { ok: true };
  }
  if (params.action === "restore") return { track: await restoreTrack(user, params.id) };
  throw notFound("Unknown action.");
});
