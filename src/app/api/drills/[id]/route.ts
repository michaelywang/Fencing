import { apiRoute, readJson } from "@/server/http";
import { getDrill, setDrillDeleted, updateDrill } from "@/server/services/library";
import { notFound } from "@/server/errors";

export const GET = apiRoute<{ id: string }>("coach", async ({ params }) => {
  const drill = await getDrill(params.id);
  if (!drill) throw notFound("Drill not found.");
  return { drill };
});
export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<{ baseVersion: number; drill: unknown }>(req);
  return { drill: await updateDrill(user, params.id, { baseVersion: Number(body.baseVersion), drill: body.drill }) };
});
export const DELETE = apiRoute<{ id: string }>("coach", async ({ user, params }) => {
  await setDrillDeleted(user, params.id, true);
  return { ok: true };
});
