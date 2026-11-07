import Link from "next/link";
import { cookies } from "next/headers";
import { WeekView } from "@/components/calendar/WeekView";
import { PublicEventCard } from "@/components/public/PublicCards";
import { WeaponPreferencePicker } from "@/components/plan/WeaponFilter";
import { buttonClass } from "@/components/ui";
import { getPhasesInRange, getPublicEvents, getPublicMeta } from "@/server/services/public";
import { addDays, formatWeekRange, isISODate, startOfWeek, todayInTimeZone } from "@/lib/dates";
import { fromPublic } from "@/lib/view";
import { WEAPON_PREF_COOKIE, parseWeaponFilter } from "@/lib/weapons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Week" };

export default async function PublicWeekPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const meta = await getPublicMeta();
  const today = todayInTimeZone(meta.timezone);
  const weekStart = startOfWeek(d && isISODate(d) ? d : today);
  const weekEnd = addDays(weekStart, 6);
  const events = (await getPublicEvents(weekStart, weekEnd)).map(fromPublic);
  const phases = await getPhasesInRange(weekStart, weekEnd);
  const weapon = parseWeaponFilter((await cookies()).get(WEAPON_PREF_COOKIE)?.value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Week of {formatWeekRange(weekStart)}</h1>
        <nav className="flex gap-2" aria-label="Change week">
          <Link className={buttonClass("secondary", "sm")} href={`/week?d=${addDays(weekStart, -7)}`}>
            ‹ Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href="/week">
            This week
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={`/week?d=${addDays(weekStart, 7)}`}>
            Next ›
          </Link>
        </nav>
      </div>
      <WeaponPreferencePicker initial={weapon} />
      <WeekView
        weekStart={weekStart}
        today={today}
        events={events}
        phases={phases}
        weapon={weapon}
        renderEventHeader={(e) => <PublicEventCard event={e} weapon={weapon} />}
      />
      {events.length === 0 ? <p className="text-sm text-slate-600">Nothing has been published for this week yet.</p> : null}
    </div>
  );
}
