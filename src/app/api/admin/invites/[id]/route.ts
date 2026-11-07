import { apiRoute } from "@/server/http";
import { revokeInvite } from "@/server/services/accounts";

export const DELETE = apiRoute<{ id: string }>("admin", async ({ user, params }) => {
  await revokeInvite(user, params.id);
  return { ok: true };
});
