import { NextResponse } from "next/server";
import { apiRoute, readJson, setSessionCookie } from "@/server/http";
import { bootstrapAdmin } from "@/server/services/accounts";
import { loadDemoData } from "@/server/services/demo";

/** First-run administrator creation (requires SETUP_TOKEN; disabled once any account exists). */
export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ setupToken?: string; name?: string; email?: string; password?: string; loadDemo?: boolean }>(req);
  const result = await bootstrapAdmin(
    { setupToken: String(body.setupToken ?? ""), name: String(body.name ?? ""), email: String(body.email ?? ""), password: String(body.password ?? "") },
    meta,
  );
  if (body.loadDemo) await loadDemoData(result.user);
  const res = NextResponse.json({ user: result.user });
  setSessionCookie(res, req, result.token, result.expiresAt);
  return res;
});
