import { Suspense } from "react";
import { CoachWeek } from "@/components/coach/CoachWeek";
import { listEvents } from "@/server/services/events";
import { getPhasesInRange } from "@/server/services/public";
import { getSettings } from "@/server/services/settings";
import { addDays, isISODate, startOfWeek, todayInTimeZone } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Week" };

export default async function CoachWeekPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const settings = await getSettings();
  const weekStart = startOfWeek(d && isISODate(d) ? d : todayInTimeZone(settings.timezone));
  const [records, phases] = await Promise.all([listEvents({ from: weekStart, to: addDays(weekStart, 6) }), getPhasesInRange(weekStart, addDays(weekStart, 6))]);
  return (
    <Suspense>
      <CoachWeek key={weekStart} weekStart={weekStart} initialRecords={records} phases={phases} />
    </Suspense>
  );
}
