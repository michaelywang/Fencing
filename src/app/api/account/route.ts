import { apiRoute, readJson } from "@/server/http";
import { updateProfile } from "@/server/services/accounts";

export const PATCH = apiRoute("coach", async ({ req, user }) => {
  const body = await readJson<{ name?: string }>(req);
  await updateProfile(user, { name: String(body.name ?? "") });
  return { ok: true };
});
