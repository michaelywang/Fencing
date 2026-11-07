import { apiRoute, readJson } from "@/server/http";
import { createEvent, listEvents } from "@/server/services/events";
import { badRequest } from "@/server/errors";

export const GET = apiRoute("coach", async ({ req }) => {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) throw badRequest("from and to are required (YYYY-MM-DD).");
  return { events: await listEvents({ from, to }) };
});

export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ doc?: unknown }>(req);
  return { event: await createEvent(user, body.doc ?? body) };
});
