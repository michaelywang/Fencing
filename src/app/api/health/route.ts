import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

/**
 * Liveness: GET /api/health → 200 when the app is running.
 * Readiness: GET /api/health?db=1 → also checks the database connection.
 * Returns no data beyond ok/error.
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("db") === "1") {
    try {
      await getDb().execute(sql`select 1`);
    } catch {
      return NextResponse.json({ ok: false, db: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: true, db: "ok" }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
