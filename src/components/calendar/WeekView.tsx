import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { LaneTag } from "@/components/badges";
import { addMinutesToTime, dayNumber, formatClock, formatWeekdayShort, weekDates } from "@/lib/dates";
import { appliesToWeapon, sortBlocks } from "@/lib/timeline";
import { PLAN_KINDS } from "@/lib/constants";
import type { ViewBlock, ViewEvent } from "@/lib/view";
import { LANE_CLASSES, WEAPONS, type Lane, type WeaponFilter } from "@/lib/weapons";
import { phaseClass, phaseOn, type PhaseLite } from "./phases";

export interface WeekViewProps {
  weekStart: string;
  today: string;
  events: ViewEvent[];
  phases: PhaseLite[];
  weapon: WeaponFilter;
  renderEventHeader: (event: ViewEvent) => ReactNode;
  renderBlock?: (event: ViewEvent, block: ViewBlock, lane: Lane) => ReactNode;
  dayActions?: (date: string, events: ViewEvent[]) => ReactNode;
}

export function defaultBlockLine(event: ViewEvent, b: ViewBlock) {
  const t = event.startTime ? formatClock(addMinutesToTime(event.startTime, b.start), { compact: true }) : `+${b.start}`;
  return (
    <span className="block text-[12px] leading-snug">
      <span className="font-semibold text-slate-900">{t}</span> <span className="text-slate-800">{b.title || "Untitled"}</span>{" "}
      <span className="text-slate-500">({b.duration})</span>
      {b.allowOverlap ? <span className="text-slate-500"> · alongside</span> : null}
    </span>
  );
}

/**
 * Parallel week layout. Desktop: rows = event header, Shared, Foil, Épée,
 * Saber; columns = days — so one weapon's progression reads across the week.
 * Phones: one stacked card per day.
 */
export function WeekView({ weekStart, today, events, phases, weapon, renderEventHeader, renderBlock, dayActions }: WeekViewProps) {
  const dates = weekDates(weekStart).filter((d, i) => i < 5 || events.some((e) => e.date === d));
  const lanes: Lane[] = ["shared", ...(weapon === "all" ? WEAPONS : [weapon])];
  const eventsOn = (date: string) => events.filter((e) => e.date === date);
  const blocksFor = (date: string, lane: Lane) =>
    eventsOn(date)
      .filter((e) => PLAN_KINDS.includes(e.kind) && e.status !== "canceled")
      .flatMap((e) =>
        sortBlocks(e.blocks.filter((b) => (lane === "shared" ? b.scope === "shared" : b.scope === "weapon" && appliesToWeapon(b, lane)))).map((b) => ({ e, b })),
      );
  const line = (e: ViewEvent, b: ViewBlock, lane: Lane) => (renderBlock ? renderBlock(e, b, lane) : defaultBlockLine(e, b));

  return (
    <>
      {/* Desktop parallel grid */}
      <div className="hidden overflow-x-auto lg:block">
        <div
          className="grid min-w-[900px] gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200"
          style={{ gridTemplateColumns: `6.5rem repeat(${dates.length}, minmax(0, 1fr))` }}
        >
          <div className="bg-slate-50" />
          {dates.map((d) => {
            const phase = phaseOn(phases, d);
            return (
              <div key={d} className={cx("relative bg-slate-50 px-2 py-1.5", d === today && "bg-gl-red-soft")}>
                {phase ? <span className={cx("absolute inset-x-0 top-0 h-1", phaseClass(phase.color).bar)} title={phase.name} aria-hidden /> : null}
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {formatWeekdayShort(d)} <span className="text-base text-slate-900">{dayNumber(d)}</span>
                  {d === today ? <span className="ml-1 rounded bg-gl-red px-1 text-[10px] text-white">Today</span> : null}
                </p>
                {phase ? <p className={cx("truncate text-[10px] font-semibold", phaseClass(phase.color).text)}>{phase.name}</p> : null}
              </div>
            );
          })}

          <div className="bg-white px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Event</div>
          {dates.map((d) => (
            <div key={d} className="space-y-2 bg-white p-1.5">
              {eventsOn(d).map((e) => (
                <div key={e.id}>{renderEventHeader(e)}</div>
              ))}
              {dayActions ? dayActions(d, eventsOn(d)) : eventsOn(d).length === 0 ? <p className="px-1 text-xs text-slate-400">No event</p> : null}
            </div>
          ))}

          {lanes.map((lane) => (
            <WeekLaneRow key={lane} lane={lane} dates={dates} blocksFor={blocksFor} line={line} />
          ))}
        </div>
      </div>

      {/* Phones and narrow tablets */}
      <ol className="space-y-3 lg:hidden">
        {dates.map((d) => {
          const dayEvents = eventsOn(d);
          return (
            <li key={d} className={cx("rounded-lg border bg-white p-3", d === today ? "border-gl-red" : "border-slate-200")}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                {formatWeekdayShort(d)} {dayNumber(d)}
                {d === today ? <span className="rounded bg-gl-red px-1.5 text-[10px] font-semibold text-white">Today</span> : null}
              </h3>
              {dayEvents.length === 0 ? <p className="text-sm text-slate-500">No event.</p> : null}
              <div className="space-y-3">
                {dayEvents.map((e) => (
                  <div key={e.id} className="space-y-2">
                    {renderEventHeader(e)}
                    {PLAN_KINDS.includes(e.kind) && e.status !== "canceled"
                      ? lanes.map((lane) => {
                          const items = sortBlocks(e.blocks.filter((b) => (lane === "shared" ? b.scope === "shared" : b.scope === "weapon" && appliesToWeapon(b, lane))));
                          if (!items.length) return null;
                          return (
                            <div key={lane} className={cx("rounded-md border-l-4 px-2 py-1", LANE_CLASSES[lane].border, LANE_CLASSES[lane].soft)}>
                              <LaneTag lane={lane} />
                              <ul className="mt-1 space-y-0.5">
                                {items.map((b) => (
                                  <li key={b.id}>{line(e, b, lane)}</li>
                                ))}
                              </ul>
                            </div>
                          );
                        })
                      : null}
                  </div>
                ))}
              </div>
              {dayActions ? <div className="mt-2">{dayActions(d, dayEvents)}</div> : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function WeekLaneRow({
  lane,
  dates,
  blocksFor,
  line,
}: {
  lane: Lane;
  dates: string[];
  blocksFor: (date: string, lane: Lane) => Array<{ e: ViewEvent; b: ViewBlock }>;
  line: (e: ViewEvent, b: ViewBlock, lane: Lane) => ReactNode;
}) {
  return (
    <>
      <div className={cx("flex items-start px-2 py-2", LANE_CLASSES[lane].soft)}>
        <LaneTag lane={lane} />
      </div>
      {dates.map((d) => {
        const items = blocksFor(d, lane);
        return (
          <div key={d} className={cx("p-1.5", items.length ? LANE_CLASSES[lane].soft : "bg-white")}>
            {items.length ? (
              <ul className="space-y-1">
                {items.map(({ e, b }) => (
                  <li key={`${e.id}:${b.id}`}>{line(e, b, lane)}</li>
                ))}
              </ul>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )}
          </div>
        );
      })}
    </>
  );
}
