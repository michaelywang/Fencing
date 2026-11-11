import { Suspense } from "react";
import { CoachWeek } from "@/components/coach/CoachWeek";
import { listEvents } from "@/server/services/events";
import { listTrackPhasesInRange } from "@/server/services/library";
import { pageTrack } from "@/server/pageTrack";
import { NoWorkspace } from "@/components/coach/NoWorkspace";
import { getSettings } from "@/server/services/settings";
import { addDays, isISODate, startOfWeek, todayInTimeZone } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Week" };

export default async function CoachWeekPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await pageTrack("/coach/week", sp);
  if (!ws) return <NoWorkspace />;
  const d = sp.d;
  const settings = await getSettings();
  const weekStart = startOfWeek(d && isISODate(d) ? d : todayInTimeZone(settings.timezone));
  const [records, phases] = await Promise.all([listEvents({ trackId: ws.track.id, from: weekStart, to: addDays(weekStart, 6) }), listTrackPhasesInRange(ws.track.id, weekStart, addDays(weekStart, 6))]);
  return (
    <Suspense>
      <CoachWeek key={`${ws.track.id}-${weekStart}`} weekStart={weekStart} initialRecords={records} phases={phases} />
    </Suspense>
  );
}
