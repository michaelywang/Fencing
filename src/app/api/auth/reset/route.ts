import { NextResponse } from "next/server";
import { apiRoute, readJson, setSessionCookie } from "@/server/http";
import { completeReset } from "@/server/services/accounts";

export const POST = apiRoute("public", async ({ req, meta }) => {
  const body = await readJson<{ token?: string; password?: string }>(req);
  const result = await completeReset(String(body.token ?? ""), String(body.password ?? ""), meta);
  const res = NextResponse.json({ user: result.user });
  setSessionCookie(res, req, result.token, result.expiresAt);
  return res;
});
