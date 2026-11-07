"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { dayNumber, formatDateLong, formatWeekdayShort, isSameMonth, monthGrid } from "@/lib/dates";
import type { ViewEvent } from "@/lib/view";
import { WEAPON_LABEL, type WeaponFilter } from "@/lib/weapons";
import { displayTitle } from "@/lib/practice";
import { EventCardBody } from "./EventCard";
import { phaseClass, phaseOn, type PhaseLite } from "./phases";

export interface MonthViewProps {
  year: number;
  month: number;
  today: string;
  events: ViewEvent[];
  phases: PhaseLite[];
  weapon: WeaponFilter;
  /** Renders a clickable/draggable card for an event (desktop grid and phone list). */
  renderCard: (event: ViewEvent, opts: { dense: boolean }) => ReactNode;
  /** Wraps a desktop day cell (e.g. a drop target). Must be a stable (module-level) component. */
  DayCell?: ComponentType<DayCellProps>;
  /** Extra controls in a day (e.g. "+ add"). */
  dayActions?: (date: string) => ReactNode;
}

export interface DayCellProps {
  date: string;
  children: ReactNode;
  className: string;
}

function PlainDay({ children, className }: DayCellProps) {
  return <div className={className}>{children}</div>;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({ year, month, today, events, phases, weapon, renderCard, DayCell, dayActions }: MonthViewProps) {
  const weeks = monthGrid(year, month);
  const byDate = new Map<string, ViewEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const initial = isSameMonth(today, year, month) ? today : weeks.flat().find((d) => isSameMonth(d, year, month) && byDate.has(d)) ?? weeks[0][0];
  const [selected, setSelected] = useState(initial);
  const visiblePhases = phases.filter((p) => p.startDate <= weeks[weeks.length - 1][6] && p.endDate >= weeks[0][0]);

  const Cell = DayCell ?? PlainDay;

  return (
    <div>
      {visiblePhases.length ? (
        <ul className="mb-2 flex flex-wrap gap-2 text-xs" aria-label="Training phases this month">
          {visiblePhases.map((p) => (
            <li key={p.id} className={cx("flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold", phaseClass(p.color).soft, phaseClass(p.color).text)} title={p.focus}>
              <span className={cx("h-2 w-2 rounded-full", phaseClass(p.color).bar)} aria-hidden />
              {p.name}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Desktop / tablet grid */}
      <div className="hidden md:block">
        <div role="grid" aria-label="Month calendar" className="overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
          <div role="row" className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => (
              <div role="columnheader" key={d} className="bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div role="row" key={week[0]} className="grid grid-cols-7 gap-px">
              {week.map((date) => {
                const inMonth = isSameMonth(date, year, month);
                const phase = phaseOn(phases, date);
                const dayEvents = byDate.get(date) ?? [];
                const isToday = date === today;
                return (
                  <Cell
                    key={date}
                    date={date}
                    className={cx("group relative flex min-h-[7.5rem] flex-col gap-1 p-1", inMonth ? "bg-white" : "bg-slate-50")}
                  >
                    {phase ? <span className={cx("absolute inset-x-0 top-0 h-1", phaseClass(phase.color).bar)} title={`${phase.name}`} aria-hidden /> : null}
                    <div role="gridcell" aria-label={formatDateLong(date)} className="flex items-center justify-between pt-0.5">
                      <span
                        className={cx(
                          "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                          isToday ? "bg-gl-red text-white" : inMonth ? "text-slate-800" : "text-slate-400",
                        )}
                      >
                        {dayNumber(date)}
                        {isToday ? <span className="sr-only"> (today)</span> : null}
                      </span>
                      {dayActions ? dayActions(date) : null}
                    </div>
                    {phase && phase.startDate === date ? (
                      <span className={cx("truncate rounded px-1 text-[10px] font-semibold", phaseClass(phase.color).soft, phaseClass(phase.color).text)}>{phase.name} begins</span>
                    ) : null}
                    {dayEvents.map((e) => (
                      <div key={e.id}>{renderCard(e, { dense: false })}</div>
                    ))}
                  </Cell>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Phone: compact grid + selected-day agenda */}
      <div className="md:hidden">
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Month calendar">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="text-[11px] font-semibold uppercase text-slate-500">
              {d.slice(0, 2)}
            </div>
          ))}
          {weeks.flat().map((date) => {
            const inMonth = isSameMonth(date, year, month);
            const dayEvents = byDate.get(date) ?? [];
            const phase = phaseOn(phases, date);
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelected(date)}
                aria-pressed={selected === date}
                aria-label={`${formatDateLong(date)}: ${dayEvents.length ? dayEvents.map((e) => displayTitle(e)).join(", ") : "nothing scheduled"}`}
                className={cx(
                  "touch-target relative flex h-12 flex-col items-center justify-start rounded-md border pt-1 text-sm",
                  selected === date ? "border-gl-blue bg-gl-blue-soft" : "border-transparent",
                  !inMonth && "text-slate-400",
                  date === today && "font-bold text-gl-red",
                )}
              >
                {phase ? <span className={cx("absolute inset-x-1 top-0 h-0.5 rounded", phaseClass(phase.color).bar)} aria-hidden /> : null}
                {dayNumber(date)}
                <span className="mt-0.5 flex gap-0.5" aria-hidden>
                  {dayEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={cx(
                        "h-1.5 w-1.5 rounded-full",
                        e.status === "canceled" ? "bg-slate-400" : e.kind === "meet" || e.kind === "tournament" ? "bg-gl-red" : e.kind === "holiday" ? "bg-slate-500" : "bg-gl-blue",
                      )}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <section className="mt-3" aria-live="polite">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            {formatWeekdayShort(selected)}, {formatDateLong(selected).split(", ").slice(1).join(", ")}
            {weapon !== "all" ? <span className="ml-2 text-xs font-normal text-slate-500">showing {WEAPON_LABEL[weapon]}</span> : null}
          </h3>
          {(byDate.get(selected) ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {(byDate.get(selected) ?? []).map((e) => (
                <li key={e.id}>{renderCard(e, { dense: false })}</li>
              ))}
            </ul>
          )}
          {dayActions ? <div className="mt-2">{dayActions(selected)}</div> : null}
        </section>
      </div>
    </div>
  );
}

export { EventCardBody };
