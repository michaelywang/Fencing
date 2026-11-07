import { NextResponse } from "next/server";
import { apiRoute, clearSessionCookie, sessionTokenFromRequest } from "@/server/http";
import { invalidateSessionByToken } from "@/server/auth/sessions";

export const POST = apiRoute("public", async ({ req }) => {
  const token = sessionTokenFromRequest(req);
  if (token) await invalidateSessionByToken(token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, req);
  return res;
});
