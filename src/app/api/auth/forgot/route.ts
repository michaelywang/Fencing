import { apiRoute, readJson } from "@/server/http";
import { requestPasswordReset } from "@/server/services/accounts";

/** Always answers the same way whether or not the email has an account. */
export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ email?: string }>(req);
  const { emailEnabled } = await requestPasswordReset(String(body.email ?? ""), meta);
  return { ok: true, emailEnabled };
});
