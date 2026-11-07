import { apiRoute, readJson } from "@/server/http";
import { setLocationArchived, updateLocation } from "@/server/services/settings";

export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => ({ location: await updateLocation(user, params.id, await readJson(req)) }));
export const PATCH = apiRoute<{ id: string }>("admin", async ({ req, user, params }) => {
  const body = await readJson<{ archived?: boolean }>(req);
  await setLocationArchived(user, params.id, Boolean(body.archived));
  return { ok: true };
});
