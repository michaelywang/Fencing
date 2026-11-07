import Link from "next/link";
import { SeasonOverview } from "@/components/calendar/SeasonOverview";
import { getPublicEvents, getPublicMeta, getPublicSeasons } from "@/server/services/public";
import { todayInTimeZone } from "@/lib/dates";
import { fromPublic } from "@/lib/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season" };

export default async function PublicSeasonPage() {
  const meta = await getPublicMeta();
  const today = todayInTimeZone(meta.timezone);
  const seasons = await getPublicSeasons();
  const events = await Promise.all(seasons.map((s) => getPublicEvents(s.startDate, s.endDate)));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Season overview</h1>
      {seasons.length === 0 ? (
        <p className="text-sm text-slate-600">
          The season outline hasn&apos;t been posted yet. See the <Link href="/month" className="underline">month calendar</Link>.
        </p>
      ) : null}
      {seasons
        .slice()
        .reverse()
        .map((s, i) => (
          <SeasonOverview key={s.id} season={s} events={events[seasons.length - 1 - i].map(fromPublic)} today={today} eventHref={(id) => `/e/${id}`} weekHref={(d) => `/week?d=${d}`} />
        ))}
    </div>
  );
}
