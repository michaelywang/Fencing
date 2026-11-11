import { apiRoute, readJson } from "@/server/http";
import { getEvent, saveEvent } from "@/server/services/events";
import { deleteEvent } from "@/server/services/publishing";
import { notFound } from "@/server/errors";
import { bool, str, type Body } from "@/server/apiInput";

export const GET = apiRoute<{ id: string }>("coach", async ({ params }) => {
  const event = await getEvent(params.id);
  if (!event) throw notFound("Event not found.");
  return { event };
});

/** Save the working copy. Requires the version the editor started from (409 on conflict). */
export const PUT = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<{ baseVersion: number; doc: unknown }>(req);
  return { event: await saveEvent(user, params.id, { baseVersion: Number(body.baseVersion), doc: body.doc }) };
});

/** Move to Trash. `unpublish: true` also removes it from the public schedule (explicit choice). */
export const DELETE = apiRoute<{ id: string }>("coach", async ({ req, user, params }) => {
  const body = await readJson<Body>(req);
  const q = req.nextUrl.searchParams;
  return deleteEvent(user, params.id, { unpublish: bool(body.unpublish) || q.get("unpublish") === "1", operationId: str(body.operationId) || null });
});
