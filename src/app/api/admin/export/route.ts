import { NextResponse } from "next/server";
import { apiRoute } from "@/server/http";
import { exportAll } from "@/server/services/transfer";
import { audit } from "@/server/audit";
import { getDb } from "@/server/db";

/** Planning export (administrators only): one track (`?track=`) or every season/track. Never includes password hashes or tokens. */
export const GET = apiRoute("admin", async ({ req, user }) => {
  const track = req.nextUrl.searchParams.get("track");
  const data = await exportAll({ trackId: track || null });
  await audit(getDb(), user.id, "export.downloaded", { trackId: track || null });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="gl-fencing-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
