import { Suspense } from "react";
import { CoachCalendar } from "@/components/coach/CoachCalendar";
import { listEvents } from "@/server/services/events";
import { listTrackPhasesInRange } from "@/server/services/library";
import { pageTrack } from "@/server/pageTrack";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { getSettings, listLocations } from "@/server/services/settings";
import { monthGrid, monthOf, parseMonthKey, todayInTimeZone } from "@/lib/dates";
import { toCard } from "@/lib/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Month" };

export default async function CoachCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await pageTrack("/coach/calendar", sp);
  if (!ws) return <NoWorkspace />;
  const m = sp.m;
  const settings = await getSettings();
  const { year, month } = parseMonthKey(m) ?? monthOf(todayInTimeZone(settings.timezone));
  const grid = monthGrid(year, month);
  const from = grid[0][0];
  const to = grid[grid.length - 1][6];
  const [records, phases, locations] = await Promise.all([listEvents({ trackId: ws.track.id, from, to }), listTrackPhasesInRange(ws.track.id, from, to), listLocations({ includeArchived: true })]);
  return (
    <Suspense>
      <CoachCalendar key={`${ws.track.id}-${year}-${month}`} year={year} month={month} initialEvents={records.map((r) => toCard(r, locations))} phases={phases} />
    </Suspense>
  );
}
