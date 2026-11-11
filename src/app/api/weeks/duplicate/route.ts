import { apiRoute, readJson } from "@/server/http";
import { duplicateWeek } from "@/server/services/events";
import { bool, str, uuidOrThrow, type Body } from "@/server/apiInput";

export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<Body>(req);
  return {
    ids: await duplicateWeek(user, {
      trackId: uuidOrThrow(body.trackId, "track"),
      sourceWeekStart: str(body.sourceWeekStart, 10),
      targetWeekStart: str(body.targetWeekStart, 10),
      copyCoaches: bool(body.copyCoaches),
      copyNotes: bool(body.copyNotes),
    }),
  };
});
