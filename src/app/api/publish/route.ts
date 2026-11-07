import { apiRoute, readJson } from "@/server/http";
import { publishEvents } from "@/server/services/events";

/** Publish several events at once (a day or a selected week). */
export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ ids?: unknown; note?: string; expectedVersions?: Record<string, number> }>(req);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  return publishEvents(user, ids, { note: typeof body.note === "string" ? body.note : "", expectedVersions: body.expectedVersions });
});
