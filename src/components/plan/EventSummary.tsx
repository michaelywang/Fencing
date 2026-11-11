import { CanceledBadge, DemoBadge, EventTypeBadge, IntensityBadge, PublicationBadge, TentativeBadge } from "@/components/badges";
import { RichText, ExternalLink } from "@/components/RichText";
import { cx } from "@/components/ui";
import { displayTitle, homeAwayLabel } from "@/lib/practice";
import { formatClock, formatClockRange, formatDateLong, formatDuration } from "@/lib/dates";
import type { ViewEvent } from "@/lib/view";
import { WEAPONS, WEAPON_LABEL } from "@/lib/weapons";

/** Event header: badges, when/where, meet logistics, theme, objectives, announcement, equipment. */
export function EventSummary({ event, showStatus, headingLevel = 1 }: { event: ViewEvent; showStatus?: boolean; headingLevel?: 1 | 2 }) {
  const H = headingLevel === 1 ? "h1" : "h2";
  const canceled = event.status === "canceled";
  const where = event.location ? event.location.name : event.locationNote;
  const address = event.location?.address || event.meet?.address || "";
  const coaches = event.coachAssignments;
  const hasCoaches = coaches && Object.values(coaches).some((c) => c.trim());
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <EventTypeBadge kind={event.kind} />
        {canceled ? <CanceledBadge /> : null}
        {event.confirmation === "tentative" ? <TentativeBadge /> : null}
        <IntensityBadge level={event.intensity} />
        {showStatus && event.publication ? <PublicationBadge state={event.publication} /> : null}
        {event.isDemo ? <DemoBadge /> : null}
      </div>
      <div>
        <H className={cx("text-xl font-bold leading-tight text-slate-900 sm:text-2xl", canceled && "line-through decoration-2")}>{displayTitle(event)}</H>
        {event.theme && event.theme !== displayTitle(event) ? <p className="mt-0.5 text-base font-medium text-slate-700">Theme: {event.theme}</p> : null}
      </div>
      {event.notice && !canceled ? (
        <div role="status" className="rounded-md border-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" data-testid="change-notice">
          {event.notice.text}
          <span className="ml-1 font-normal text-amber-900">(updated {new Date(event.notice.at).toLocaleString("en-US", { timeZone: event.timezone ?? "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})</span>
        </div>
      ) : null}
      {canceled ? (
        <div role="alert" className="rounded-md border-2 border-red-700 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          This event is canceled{event.cancelReason ? `: ${event.cancelReason}` : "."}
        </div>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-slate-500">When</dt>
          <dd className="text-slate-900">
            {formatDateLong(event.date)}
            <br />
            <span className="font-semibold">{formatClockRange(event.startTime, event.endTime)}</span>
            {event.startTime && event.endTime && (event.kind === "practice" || event.kind === "recovery") ? (
              <span className="text-slate-500"> · {formatDuration(event.targetMinutes)} plan</span>
            ) : null}
          </dd>
        </div>
        {where ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-semibold text-slate-500">Where</dt>
            <dd className="text-slate-900">
              {where}
              {address ? <span className="block text-slate-600">{address}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {event.meet && (event.meet.opponent || event.meet.busDepart || event.meet.reportTime || event.meet.busReturn) ? (
        <div className="rounded-md border border-gl-red/30 bg-gl-red-soft px-3 py-2 text-sm">
          <p className="font-semibold text-gl-red-dark">
            {event.meet.opponent ? `${event.meet.homeAway === "away" ? "At" : event.meet.homeAway === "home" ? "Vs." : "Opponent:"} ${event.meet.opponent}` : "Competition logistics"}
            {event.meet.homeAway ? <span className="ml-2 font-medium text-slate-700">({homeAwayLabel(event.meet.homeAway)})</span> : null}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-slate-900">
            {event.meet.reportTime ? <li><span className="font-semibold">Report:</span> {formatClock(event.meet.reportTime)}</li> : null}
            {event.meet.busDepart ? <li><span className="font-semibold">Bus departs:</span> {formatClock(event.meet.busDepart)}</li> : null}
            {event.meet.busReturn ? <li><span className="font-semibold">Bus returns (approx.):</span> {formatClock(event.meet.busReturn)}</li> : null}
          </ul>
          {event.meet.details ? <RichText text={event.meet.details} className="mt-1 space-y-1 text-sm text-slate-800" /> : null}
        </div>
      ) : null}
      {event.announcement ? (
        <div className="rounded-md border-l-4 border-gl-blue bg-gl-blue-soft px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gl-blue">Announcement</p>
          <RichText text={event.announcement} />
        </div>
      ) : null}
      {event.objectives.length ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Objectives</p>
          <ul className="ml-5 list-disc text-sm text-slate-800">
            {event.objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {event.equipment.length ? (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bring / equipment</p>
            <p className="text-slate-800">{event.equipment.join(" · ")}</p>
          </div>
        ) : null}
        {hasCoaches ? (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Coaches</p>
            <p className="text-slate-800">
              {coaches!.shared ? <span className="mr-3">Shared: {coaches!.shared}</span> : null}
              {WEAPONS.filter((w) => coaches![w]).map((w) => (
                <span key={w} className="mr-3">
                  {WEAPON_LABEL[w]}: {coaches![w]}
                </span>
              ))}
            </p>
          </div>
        ) : null}
      </div>
      {event.levelNotes.beginner || event.levelNotes.experienced ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {event.levelNotes.beginner ? (
            <div className="rounded-md bg-slate-50 px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Beginners</p>
              <RichText text={event.levelNotes.beginner} />
            </div>
          ) : null}
          {event.levelNotes.experienced ? (
            <div className="rounded-md bg-slate-50 px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Experienced fencers</p>
              <RichText text={event.levelNotes.experienced} />
            </div>
          ) : null}
        </div>
      ) : null}
      {event.links.length ? (
        <ul className="flex flex-wrap gap-3 text-sm">
          {event.links.map((l, i) => (
            <li key={i}>
              <ExternalLink href={l.url}>{l.label || l.url}</ExternalLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
