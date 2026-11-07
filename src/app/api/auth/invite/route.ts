import { NextResponse } from "next/server";
import { apiRoute, readJson, setSessionCookie } from "@/server/http";
import { acceptInvite } from "@/server/services/accounts";

export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ token?: string; name?: string; password?: string }>(req);
  const result = await acceptInvite(String(body.token ?? ""), { name: String(body.name ?? ""), password: String(body.password ?? "") }, meta);
  const res = NextResponse.json({ user: result.user });
  setSessionCookie(res, req, result.token, result.expiresAt);
  return res;
});
