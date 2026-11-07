import { apiRoute, readJson } from "@/server/http";
import { createResetLinkForUser } from "@/server/services/accounts";

export const POST = apiRoute<{ id: string }>("admin", async ({ req, user, params, meta }) => {
  const body = await readJson<{ email?: boolean }>(req);
  return createResetLinkForUser(user, params.id, meta.appUrl, { email: Boolean(body.email) });
});
