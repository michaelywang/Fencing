import { NextResponse } from "next/server";
import { apiRoute } from "@/server/http";
import { exportAll } from "@/server/services/transfer";
import { audit } from "@/server/audit";
import { getDb } from "@/server/db";

/** Full structured export (administrators only). Never includes password hashes or tokens. */
export const GET = apiRoute("admin", async ({ user }) => {
  const data = await exportAll();
  await audit(getDb(), user.id, "export.downloaded", {});
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="gl-fencing-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
