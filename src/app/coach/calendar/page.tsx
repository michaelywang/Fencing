import { Suspense } from "react";
import { CoachCalendar } from "@/components/coach/CoachCalendar";
import { listEvents } from "@/server/services/events";
import { getPhasesInRange } from "@/server/services/public";
import { getSettings, listLocations } from "@/server/services/settings";
import { monthGrid, monthOf, parseMonthKey, todayInTimeZone } from "@/lib/dates";
import { toCard } from "@/lib/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Month" };

export default async function CoachCalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const settings = await getSettings();
  const { year, month } = parseMonthKey(m) ?? monthOf(todayInTimeZone(settings.timezone));
  const grid = monthGrid(year, month);
  const from = grid[0][0];
  const to = grid[grid.length - 1][6];
  const [records, phases, locations] = await Promise.all([listEvents({ from, to }), getPhasesInRange(from, to), listLocations({ includeArchived: true })]);
  return (
    <Suspense>
      <CoachCalendar key={`${year}-${month}`} year={year} month={month} initialEvents={records.map((r) => toCard(r, locations))} phases={phases} />
    </Suspense>
  );
}
