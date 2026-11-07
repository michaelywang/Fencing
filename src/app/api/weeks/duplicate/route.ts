import { apiRoute, readJson } from "@/server/http";
import { duplicateWeek } from "@/server/services/events";

export const POST = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ sourceWeekStart?: string; targetWeekStart?: string; copyCoaches?: boolean; copyNotes?: boolean }>(req);
  return {
    ids: await duplicateWeek(user, {
      sourceWeekStart: String(body.sourceWeekStart ?? ""),
      targetWeekStart: String(body.targetWeekStart ?? ""),
      copyCoaches: Boolean(body.copyCoaches),
      copyNotes: Boolean(body.copyNotes),
    }),
  };
});
