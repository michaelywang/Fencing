import { apiRoute, readJson } from "@/server/http";
import { setUserDisabled, setUserRole } from "@/server/services/accounts";

export const PATCH = apiRoute<{ id: string }>("admin", async ({ req, user, params }) => {
  const body = await readJson<{ role?: "admin" | "coach"; disabled?: boolean }>(req);
  if (body.role) await setUserRole(user, params.id, body.role);
  if (typeof body.disabled === "boolean") await setUserDisabled(user, params.id, body.disabled);
  return { ok: true };
});
