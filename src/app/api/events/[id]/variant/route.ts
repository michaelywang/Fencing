import { apiRoute } from "@/server/http";
import { findVariant, getEvent } from "@/server/services/events";
import { getDb } from "@/server/db";
import { events } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "@/server/errors";
import { uuidOrThrow } from "@/server/apiInput";

/** The same LOGICAL event's working copy in another track (for switching tracks while viewing an event). */
export const GET = apiRoute<{ id: string }>("coach", async ({ req, params }) => {
  const rec = await getEvent(params.id);
  const [row] = rec ? [rec] : await getDb().select().from(events).where(eq(events.id, uuidOrThrow(params.id))).limit(1);
  if (!row) throw notFound("Event not found.");
  return { id: await findVariant(row.logicalId, uuidOrThrow(req.nextUrl.searchParams.get("track"), "track")), date: row.date };
});
