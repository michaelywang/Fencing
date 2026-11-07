import { apiRoute, readJson } from "@/server/http";
import { recoverAccount } from "@/server/services/accounts";

/** Break-glass recovery; disabled unless RECOVERY_TOKEN is set on the server. */
export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ recoveryToken?: string; email?: string }>(req);
  const link = await recoverAccount({ recoveryToken: String(body.recoveryToken ?? ""), email: String(body.email ?? "") }, meta);
  return { url: link.url, expiresAt: link.expiresAt };
});
