import { NextResponse } from "next/server";
import { apiRoute, readJson, setSessionCookie } from "@/server/http";
import { login } from "@/server/services/accounts";

export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const result = await login({ email: String(body.email ?? ""), password: String(body.password ?? "") }, meta);
  const res = NextResponse.json({ user: result.user });
  setSessionCookie(res, req, result.token, result.expiresAt);
  return res;
});
