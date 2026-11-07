import { SeasonOverview } from "@/components/calendar/SeasonOverview";
import { SeasonManager } from "@/components/coach/SeasonManager";
import { listEvents } from "@/server/services/events";
import { listSeasons } from "@/server/services/library";
import { getSettings, listLocations } from "@/server/services/settings";
import { diffDays, todayInTimeZone, addDays } from "@/lib/dates";
import { toCard } from "@/lib/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season" };

export default async function CoachSeasonPage() {
  const [seasons, settings, locations] = await Promise.all([listSeasons(), getSettings(), listLocations({ includeArchived: true })]);
  const today = todayInTimeZone(settings.timezone);
  const overviews = await Promise.all(
    seasons.map(async (s) => {
      const end = diffDays(s.startDate, s.endDate) > 390 ? addDays(s.startDate, 390) : s.endDate;
      const events = await listEvents({ from: s.startDate, to: end });
      return { season: s, events: events.map((e) => toCard(e, locations)) };
    }),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Season</h1>
      <p className="text-sm text-slate-600">The coach overview includes drafts. Phases and published competitions also appear on the public Season page.</p>
      {overviews.map(({ season, events }) => (
        <SeasonOverview key={season.id} season={season} events={events} today={today} eventHref={(id) => `/coach/e/${id}`} weekHref={(d) => `/coach/week?d=${d}`} />
      ))}
      <h2 className="pt-2 text-lg font-bold text-slate-900">Edit seasons and phases</h2>
      <SeasonManager seasons={seasons} />
    </div>
  );
}
