import Link from "next/link";
import { cookies } from "next/headers";
import { EventSummary } from "@/components/plan/EventSummary";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { WeaponPreferencePicker } from "@/components/plan/WeaponFilter";
import { PublicEventCard } from "@/components/public/PublicCards";
import { RichText } from "@/components/RichText";
import { Card, LinkButton } from "@/components/ui";
import { getNextUp, getPublicEvents, getPublicMeta } from "@/server/services/public";
import { addDays, dayNumber, formatDateLong, formatWeekdayShort } from "@/lib/dates";
import { fromPublic } from "@/lib/view";
import { WEAPON_PREF_COOKIE, parseWeaponFilter } from "@/lib/weapons";
import { PLAN_KINDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const meta = await getPublicMeta();
  const weapon = parseWeaponFilter((await cookies()).get(WEAPON_PREF_COOKIE)?.value);
  const { today, next, todayDate } = await getNextUp(meta.timezone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayDate, i));
  const upcoming = (await getPublicEvents(todayDate, days[6])).map(fromPublic);
  const todayEvents = today.map(fromPublic);
  const focus = next ? fromPublic(next) : null;
  const focusIsToday = focus?.date === todayDate;
  const otherToday = todayEvents.filter((e) => e.id !== focus?.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gl-red">{formatDateLong(todayDate)}</p>
          <h1 className="text-2xl font-bold text-slate-900">{meta.teamName}</h1>
          {meta.publicIntro ? <RichText text={meta.publicIntro} className="mt-1 max-w-prose space-y-1 text-sm text-slate-700" /> : null}
        </div>
        <WeaponPreferencePicker initial={weapon} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* 1. Today / next up (summary) */}
        <section aria-labelledby="next-heading" className="order-1 min-w-0 space-y-3 lg:col-start-1 lg:row-start-1">
          <h2 id="next-heading" className="text-lg font-bold text-slate-900">
            {focusIsToday || todayEvents.length ? "Today" : "No practice today — next up"}
          </h2>
          {otherToday.map((e) => (
            <Card key={e.id} className="p-3">
              <EventSummary event={e} headingLevel={2} />
              <Link href={`/e/${e.id}`} className="mt-2 inline-block text-sm font-semibold text-gl-blue underline">Details</Link>
            </Card>
          ))}
          {focus ? (
            <Card className="p-3 sm:p-4">
              {!focusIsToday ? <p className="mb-2 text-sm font-semibold text-gl-blue">Next scheduled event</p> : null}
              <EventSummary event={focus} headingLevel={2} />
            </Card>
          ) : (
            <Card className="p-4 text-sm text-slate-700">Nothing is scheduled yet. Check back soon.</Card>
          )}
        </section>

        {/* 2. Next 7 days */}
        <aside aria-labelledby="week-heading" className="order-2 space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 id="week-heading" className="text-lg font-bold text-slate-900">
            Next 7 days
          </h2>
          <ol className="space-y-2">
            {days.map((d) => {
              const items = upcoming.filter((e) => e.date === d);
              return (
                <li key={d} className="flex gap-2">
                  <div className={`w-11 shrink-0 pt-1 text-center ${d === todayDate ? "text-gl-red" : "text-slate-600"}`}>
                    <p className="text-[11px] font-semibold uppercase">{d === todayDate ? "Today" : formatWeekdayShort(d)}</p>
                    <p className="text-lg font-bold leading-none">{dayNumber(d)}</p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    {items.length ? items.map((e) => <PublicEventCard key={e.id} event={e} weapon={weapon} />) : <p className="pt-2 text-sm text-slate-400">No event</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/week" size="sm">Week plan</LinkButton>
            <LinkButton href="/month" size="sm">Month</LinkButton>
            <LinkButton href="/season" size="sm">Season</LinkButton>
          </div>
          <p className="text-xs text-slate-500">Your weapon choice is remembered on this device only — no account needed.</p>
        </aside>

        {/* 3. Practice plan for the next practice */}
        {focus && PLAN_KINDS.includes(focus.kind) ? (
          <section aria-labelledby="plan-heading" className="order-3 min-w-0 space-y-2 lg:col-start-1 lg:row-start-2">
            <div className="flex items-center justify-between">
              <h2 id="plan-heading" className="text-lg font-bold text-slate-900">
                {focusIsToday ? "Today's plan" : "Practice plan"}
              </h2>
              <Link href={`/e/${focus.id}`} className="text-sm font-semibold text-gl-blue underline">
                Full page
              </Link>
            </div>
            <PracticePlan event={focus} initialWeapon={weapon} rememberWeapon sectionsOpen={false} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
