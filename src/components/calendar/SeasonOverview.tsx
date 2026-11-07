import Link from "next/link";
import { cx } from "@/components/ui";
import { CanceledBadge, EventTypeBadge, IntensityBadge, TentativeBadge } from "@/components/badges";
import { RichText } from "@/components/RichText";
import { addDays, diffDays, formatDateMedium, formatMonthDay, startOfWeek } from "@/lib/dates";
import { displayTitle } from "@/lib/practice";
import { COMPETITION_KINDS, PLAN_KINDS } from "@/lib/constants";
import type { ViewEvent } from "@/lib/view";
import { phaseClass, type PhaseLite } from "./phases";

interface SeasonLike {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  phases: PhaseLite[];
}

/**
 * Season at a glance: phase bands on a week-by-week strip, weekly practice
 * load (count and average intensity) and the list of competitions.
 */
export function SeasonOverview({
  season,
  events,
  today,
  eventHref,
  weekHref,
}: {
  season: SeasonLike;
  events: ViewEvent[];
  today: string;
  eventHref: (id: string) => string;
  weekHref: (date: string) => string;
}) {
  const first = startOfWeek(season.startDate);
  const weeks: string[] = [];
  for (let d = first; d <= season.endDate; d = addDays(d, 7)) weeks.push(d);
  const competitions = events.filter((e) => COMPETITION_KINDS.includes(e.kind));
  const totalDays = Math.max(1, diffDays(season.startDate, season.endDate) + 1);

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-3 sm:p-4" aria-labelledby={`season-${season.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`season-${season.id}`} className="text-lg font-bold text-slate-900">
          {season.name}
        </h2>
        <p className="text-sm text-slate-600">
          {formatDateMedium(season.startDate)} – {formatDateMedium(season.endDate)}
        </p>
      </div>

      {/* Phase band */}
      {season.phases.length ? (
        <div>
          <div className="relative flex h-8 overflow-hidden rounded-md bg-slate-100" aria-hidden>
            {season.phases.map((p) => {
              const left = (Math.max(0, diffDays(season.startDate, p.startDate)) / totalDays) * 100;
              const width = ((diffDays(p.startDate, p.endDate) + 1) / totalDays) * 100;
              return (
                <div
                  key={p.id}
                  className={cx("absolute inset-y-0 flex items-center overflow-hidden px-2 text-xs font-semibold text-white", phaseClass(p.color).bar)}
                  style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
                >
                  <span className="truncate">{p.name}</span>
                </div>
              );
            })}
            {today >= season.startDate && today <= season.endDate ? (
              <div className="absolute inset-y-0 w-0.5 bg-gl-red" style={{ left: `${(diffDays(season.startDate, today) / totalDays) * 100}%` }} title="Today" />
            ) : null}
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {season.phases.map((p) => (
              <li key={p.id} className={cx("rounded-md border-l-4 px-3 py-2", phaseClass(p.color).soft)} style={{ borderLeftColor: "currentColor" }}>
                <p className={cx("text-sm font-bold", phaseClass(p.color).text)}>
                  {p.name}
                  {today >= p.startDate && today <= p.endDate ? <span className="ml-2 rounded bg-gl-red px-1.5 text-[10px] text-white">Now</span> : null}
                </p>
                <p className="text-xs text-slate-600">
                  {formatMonthDay(p.startDate)} – {formatMonthDay(p.endDate)}
                </p>
                <RichText text={p.focus} className="mt-1 text-sm text-slate-800" />
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-slate-600">No training phases have been added yet.</p>
      )}

      {/* Week strip */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Week by week</h3>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {weeks.map((w) => {
            const inWeek = events.filter((e) => e.date >= w && e.date <= addDays(w, 6) && e.status !== "canceled");
            const practices = inWeek.filter((e) => PLAN_KINDS.includes(e.kind));
            const comps = inWeek.filter((e) => COMPETITION_KINDS.includes(e.kind));
            const avg = practices.filter((e) => e.intensity).reduce((s, e, _, arr) => s + (e.intensity ?? 0) / arr.length, 0);
            const phase = season.phases.find((p) => p.startDate <= addDays(w, 3) && p.endDate >= addDays(w, 3));
            const current = today >= w && today <= addDays(w, 6);
            return (
              <Link
                key={w}
                href={weekHref(w)}
                className={cx("flex w-16 shrink-0 flex-col rounded-md border px-1.5 py-1 text-center text-[11px]", current ? "border-gl-red ring-1 ring-gl-red" : "border-slate-200", phase ? phaseClass(phase.color).soft : "bg-white")}
                aria-label={`Week of ${formatMonthDay(w)}: ${practices.length} practices${comps.length ? `, ${comps.length} competitions` : ""}`}
              >
                <span className="font-semibold text-slate-700">{formatMonthDay(w)}</span>
                <span className="text-slate-600">{practices.length} prac.</span>
                <span className="mx-auto mt-0.5 flex h-6 items-end gap-[2px]" aria-hidden>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={cx("w-1 rounded-sm", i <= Math.round(avg) ? "bg-slate-700" : "bg-slate-300")} style={{ height: 4 + i * 4 }} />
                  ))}
                </span>
                {comps.length ? <span className="mt-0.5 font-bold text-gl-red">★ {comps.length}</span> : <span className="mt-0.5">&nbsp;</span>}
              </Link>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-slate-500">Bars show the average planned intensity; ★ marks meets and tournaments.</p>
      </div>

      {/* Competitions */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Competitions</h3>
        {competitions.length === 0 ? (
          <p className="text-sm text-slate-600">No meets or tournaments posted yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {competitions.map((e) => (
              <li key={e.id}>
                <Link href={eventHref(e.id)} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-slate-50">
                  <span className="w-24 shrink-0 text-sm font-semibold text-slate-700">{formatDateMedium(e.date)}</span>
                  <EventTypeBadge kind={e.kind} compact />
                  {e.status === "canceled" ? <CanceledBadge /> : null}
                  {e.confirmation === "tentative" ? <TentativeBadge /> : null}
                  <span className={cx("text-sm font-medium text-slate-900", e.status === "canceled" && "line-through")}>{displayTitle(e)}</span>
                  <IntensityBadge level={e.intensity} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
