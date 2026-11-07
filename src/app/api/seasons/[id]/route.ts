import { apiRoute, readJson } from "@/server/http";
import { deleteSeason, updateSeason } from "@/server/services/library";

export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => ({ season: await updateSeason(user, params.id, await readJson(req)) }));
export const DELETE = apiRoute<{ id: string }>("admin", async ({ user, params }) => {
  await deleteSeason(user, params.id);
  return { ok: true };
});
