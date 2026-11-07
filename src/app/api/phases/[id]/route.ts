import { apiRoute, readJson } from "@/server/http";
import { deletePhase, updatePhase } from "@/server/services/library";

export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => ({ phase: await updatePhase(user, params.id, await readJson(req)) }));
export const DELETE = apiRoute<{ id: string }>("coach", async ({ user, params }) => {
  await deletePhase(user, params.id);
  return { ok: true };
});
