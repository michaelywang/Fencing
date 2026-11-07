import { NextResponse, type NextRequest } from "next/server";
import { getPublicEvents } from "@/server/services/public";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { getSettings } from "@/server/services/settings";

/** Public, read-only JSON feed of PUBLISHED events (sanitized projections only). */
export async function GET(req: NextRequest) {
  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);
  const from = req.nextUrl.searchParams.get("from") ?? addDays(today, -7);
  const to = req.nextUrl.searchParams.get("to") ?? addDays(today, 60);
  const events = await getPublicEvents(from, to);
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-cache" } });
}
