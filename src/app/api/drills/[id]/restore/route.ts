import { apiRoute } from "@/server/http";
import { setDrillDeleted } from "@/server/services/library";

export const POST = apiRoute<{ id: string }>("coach", async ({ user, params }) => {
  await setDrillDeleted(user, params.id, false);
  return { ok: true };
});
