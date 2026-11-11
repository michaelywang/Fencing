import { SeasonOverview } from "@/components/calendar/SeasonOverview";
import { SeasonManager } from "@/components/coach/SeasonManager";
import { listEvents } from "@/server/services/events";
import { listSeasons } from "@/server/services/library";
import { getPhasesInRange } from "@/server/services/public";
import { getSettings, listLocations } from "@/server/services/settings";
import { pageTrack } from "@/server/pageTrack";
import { diffDays, todayInTimeZone, addDays } from "@/lib/dates";
import { toCard } from "@/lib/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season" };

/** Season planning for the selected track: its events and phases, plus the shared season settings. */
export default async function CoachSeasonPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ws = await pageTrack("/coach/season", sp);
  const [seasons, settings, locations] = await Promise.all([listSeasons({ trackId: ws?.track.id ?? null }), getSettings(), listLocations({ includeArchived: true })]);
  const today = todayInTimeZone(settings.timezone);
  const current = ws ? seasons.find((s) => s.id === ws.season.id) ?? null : null;
  const end = current ? (diffDays(current.startDate, current.endDate) > 390 ? addDays(current.startDate, 390) : current.endDate) : null;
  const events = current && ws && end ? await listEvents({ trackId: ws.track.id, from: current.startDate, to: end }) : [];
  const published = current ? await getPhasesInRange(current.startDate, current.endDate) : [];
  const t = ws ? `&track=${ws.track.id}` : "";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Season{ws ? ` — ${ws.track.name}` : ""}</h1>
      <p className="text-sm text-slate-600">
        This overview shows the selected track, including drafts. Students see only what has been published (events and published phases).
      </p>
      {current ? (
        <SeasonOverview season={current} events={events.map((e) => toCard(e, locations))} today={today} eventHref={(id) => `/coach/e/${id}?${t.slice(1)}`} weekHref={(d) => `/coach/week?d=${d}${t}`} />
      ) : null}
      <h2 className="pt-2 text-lg font-bold text-slate-900">Seasons and {ws ? `${ws.track.name}'s ` : ""}phases</h2>
      <SeasonManager
        seasons={seasons}
        trackId={ws?.track.id ?? null}
        trackName={ws?.track.name ?? null}
        trackSeasonId={ws?.season.id ?? null}
        publishedPhases={published.filter((p) => p.seasonId === current?.id).length}
      />
    </div>
  );
}
