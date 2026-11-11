import { apiRoute, readJson } from "@/server/http";
import { createEvent, listEvents } from "@/server/services/events";
import { badRequest } from "@/server/errors";
import { uuidOrThrow, type Body } from "@/server/apiInput";

/** Events of ONE planning track (the tab's selected track) in a date range. */
export const GET = apiRoute("coach", async ({ req }) => {
  const p = req.nextUrl.searchParams;
  const from = p.get("from");
  const to = p.get("to");
  if (!from || !to) throw badRequest("from and to are required (YYYY-MM-DD).");
  return { events: await listEvents({ trackId: uuidOrThrow(p.get("track"), "track"), from, to }) };
});

export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  return { event: await createEvent(user, body.doc ?? body, { trackId: uuidOrThrow(body.trackId, "track") }) };
});
