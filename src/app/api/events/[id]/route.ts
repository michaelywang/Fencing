import { apiRoute, readJson } from "@/server/http";
import { deleteEvent, getEvent, saveEvent } from "@/server/services/events";
import { notFound } from "@/server/errors";

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

export const DELETE = apiRoute<{ id: string }>("coach", async ({ user, params }) => {
  await deleteEvent(user, params.id);
  return { ok: true };
});
