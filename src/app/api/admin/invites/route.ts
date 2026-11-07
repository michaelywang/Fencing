import { apiRoute, readJson } from "@/server/http";
import { createInvite } from "@/server/services/accounts";

export const POST = apiRoute("admin", async ({ req, user, meta }) => {
  const body = await readJson<{ email?: string; role?: "admin" | "coach"; name?: string }>(req);
  return createInvite(user, { email: String(body.email ?? ""), role: body.role === "admin" ? "admin" : "coach", name: body.name }, meta.appUrl);
});
