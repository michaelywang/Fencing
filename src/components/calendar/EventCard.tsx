import { CanceledBadge, DemoBadge, EventTypeBadge, IntensityBadge, KIND_BORDER, PublicationBadge, TentativeBadge, WeaponTag } from "@/components/badges";
import { cx } from "@/components/ui";
import { formatClock } from "@/lib/dates";
import { displayTitle } from "@/lib/practice";
import { PLAN_KINDS } from "@/lib/constants";
import type { ViewEvent } from "@/lib/view";
import { WEAPONS, type WeaponFilter } from "@/lib/weapons";

/** Compact calendar card: time, type, theme, intensity, (coach) publication status, weapon summaries. */
export function EventCardBody({ event, weapon = "all", showStatus, dense }: { event: ViewEvent; weapon?: WeaponFilter; showStatus?: boolean; dense?: boolean }) {
  const canceled = event.status === "canceled";
  const isPlan = PLAN_KINDS.includes(event.kind);
  const summaries = isPlan ? WEAPONS.filter((w) => (weapon === "all" || weapon === w) && event.weaponSummaries[w]) : [];
  const title = event.kind === "practice" && event.theme ? event.theme : displayTitle(event);
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] font-bold text-slate-900">{event.startTime ? formatClock(event.startTime, { compact: true }) : "All day"}</span>
        <EventTypeBadge kind={event.kind} compact />
        {canceled ? <CanceledBadge /> : null}
        {event.confirmation === "tentative" ? <TentativeBadge /> : null}
        {event.notice && !canceled ? (
          <span className="rounded bg-amber-200 px-1 text-[10px] font-bold uppercase text-amber-950" title={event.notice.text}>
            Updated
          </span>
        ) : null}
        {showStatus && event.publication ? <PublicationBadge state={event.publication} /> : null}
        {event.isDemo && !dense ? <DemoBadge /> : null}
      </span>
      <span className={cx("mt-0.5 block text-[13px] font-semibold leading-tight text-slate-900", dense ? "line-clamp-1" : "line-clamp-2", canceled && "line-through")}>{title}</span>
      {event.meet?.busDepart && !canceled ? <span className="block text-[11px] text-slate-700">Bus {formatClock(event.meet.busDepart, { compact: true })}</span> : null}
      {event.intensity ? (
        <span className="block">
          <IntensityBadge level={event.intensity} compact={dense} />
        </span>
      ) : null}
      {summaries.length && !canceled ? (
        <span className="mt-0.5 block space-y-0.5">
          {summaries.map((w) => (
            <span key={w} className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-slate-700">
              <WeaponTag weapon={w} abbr />
              <span className="truncate">{event.weaponSummaries[w]}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function cardFrameClass(event: ViewEvent, selected?: boolean) {
  return cx(
    "block w-full rounded-md border border-l-4 bg-white px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow",
    KIND_BORDER[event.kind],
    event.confirmation === "tentative" ? "border-dashed border-slate-400" : "border-slate-200",
    event.status === "canceled" && "bg-slate-50 opacity-80",
    event.publication === "draft" && "bg-[repeating-linear-gradient(135deg,#fff,#fff_8px,#f8fafc_8px,#f8fafc_16px)]",
    selected && "ring-2 ring-gl-blue",
  );
}
