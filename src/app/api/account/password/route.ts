import { apiRoute, readJson } from "@/server/http";
import { changePassword } from "@/server/services/accounts";

export const POST = apiRoute("coach", async ({ req, user, session }) => {
  const body = await readJson<{ current?: string; next?: string }>(req);
  await changePassword(user, session.sessionId, String(body.current ?? ""), String(body.next ?? ""));
  return { ok: true };
});
