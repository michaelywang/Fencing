import { WeekView } from "@/components/calendar/WeekView";
import { PreviewBanner } from "@/components/coach/PreviewBanner";
import { EventCardBody, cardFrameClass } from "@/components/calendar/EventCard";
import { listEvents } from "@/server/services/events";
import { getPhasesInRange } from "@/server/services/public";
import { getSettings, listLocations } from "@/server/services/settings";
import { toPublicEvent } from "@/lib/projection";
import { fromPublic } from "@/lib/view";
import { addDays, formatWeekRange, isISODate, startOfWeek, todayInTimeZone } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Week preview" };

/** Week preview: every event in the week as students would see it if everything were published now. */
export default async function WeekPreviewPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const settings = await getSettings();
  const weekStart = startOfWeek(week && isISODate(week) ? week : todayInTimeZone(settings.timezone));
  const [records, locations, phases] = await Promise.all([listEvents({ from: weekStart, to: addDays(weekStart, 6) }), listLocations({ includeArchived: true }), getPhasesInRange(weekStart, addDays(weekStart, 6))]);
  const events = records.map((r) => {
    const loc = locations.find((l) => l.id === r.locationId);
    return fromPublic(toPublicEvent(r, { id: r.id, timezone: r.timezone, location: loc ? { name: loc.name, shortName: loc.shortName, address: loc.address } : null, showCoachNames: settings.showCoachNamesPublicly, publishedAt: new Date().toISOString() }));
  });
  return (
    <div className="space-y-3">
      <PreviewBanner weekStart={weekStart} />
      <h1 className="text-xl font-bold text-slate-900">Week of {formatWeekRange(weekStart)} — student view</h1>
      <WeekView
        weekStart={weekStart}
        today={todayInTimeZone(settings.timezone)}
        events={events}
        phases={phases}
        weapon="all"
        renderEventHeader={(e) => (
          <a href={`/coach/preview/${e.id}`} className={cardFrameClass(e)}>
            <EventCardBody event={e} />
          </a>
        )}
      />
    </div>
  );
}
