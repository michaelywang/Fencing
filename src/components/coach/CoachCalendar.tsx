"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useSyncedState } from "@/components/hooks";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { api, ApiError } from "@/lib/api-client";
import { addMonths, formatDateMedium, formatMonthYear, monthKey } from "@/lib/dates";
import { EVENT_KINDS, EVENT_KIND_LABEL, type EventKind } from "@/lib/constants";
import { displayTitle } from "@/lib/practice";
import { toCard, type EventRecord, type ViewEvent } from "@/lib/view";
import { parseWeaponFilter, type WeaponFilter } from "@/lib/weapons";
import { MonthView, type DayCellProps } from "@/components/calendar/MonthView";
import { EventCardBody, cardFrameClass } from "@/components/calendar/EventCard";
import type { PhaseLite } from "@/components/calendar/phases";
import { WeaponFilterControl } from "@/components/plan/WeaponFilter";
import { buttonClass, cx } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";
import { EventPanel } from "./EventPanel";
import { NewEventButton } from "./NewEventButton";

function DroppableDay({ date, children, className }: DayCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, data: { date } });
  return (
    <div ref={setNodeRef} className={cx(className, isOver && "bg-gl-blue-soft outline-2 outline-dashed outline-gl-blue")}>
      {children}
    </div>
  );
}

function DraggableCard({ event, weapon, selected, dense, onOpen }: { event: ViewEvent; weapon: WeaponFilter; selected: boolean; dense: boolean; onOpen: () => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `event:${event.id}`, data: { event } });
  return (
    <div ref={setNodeRef} {...listeners} className={cx("touch-manipulation", isDragging && "opacity-40")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${displayTitle(event)}, ${formatDateMedium(event.date)}${event.publication ? `, ${event.publication}` : ""}. Open details. Drag to move to another day.`}
        className={cardFrameClass(event, selected)}
      >
        <EventCardBody event={event} weapon={weapon} showStatus dense={dense} />
      </button>
    </div>
  );
}

export function CoachCalendar({
  year,
  month,
  initialEvents,
  phases,
}: {
  year: number;
  month: number;
  initialEvents: ViewEvent[];
  phases: PhaseLite[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const { locations, today } = useCoach();
  const [events, setEvents] = useSyncedState(initialEvents);
  const [dragging, setDragging] = useState<ViewEvent | null>(null);

  const selectedId = params.get("e");
  const weapon = parseWeaponFilter(params.get("w"));
  const typesParam = params.get("types");
  const types = useMemo(() => new Set<EventKind>(typesParam ? (typesParam.split(",").filter((t) => (EVENT_KINDS as readonly string[]).includes(t)) as EventKind[]) : EVENT_KINDS), [typesParam]);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const monthHref = (y: number, m: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("m", monthKey(y, m));
    next.delete("e");
    return `${pathname}?${next.toString()}`;
  };

  const upsert = useCallback(
    (rec: EventRecord) => setEvents((prev) => {
      const card = toCard(rec, locations);
      return prev.some((e) => e.id === rec.id) ? prev.map((e) => (e.id === rec.id ? card : e)) : [...prev, card];
    }),
    [locations, setEvents],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  async function moveTo(ev: ViewEvent, date: string, isUndo = false) {
    const prevDate = ev.date;
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, date } : e)));
    try {
      const r = await api<{ event: EventRecord }>(`/api/events/${ev.id}/move`, { body: { baseVersion: ev.version, date } });
      upsert(r.event);
      if (!isUndo) {
        toast({
          message: `Moved to ${formatDateMedium(date)}.${r.event.publication === "changed" ? " Publish to update students." : ""}`,
          action: { label: "Undo", onClick: () => void moveTo(toCard(r.event, locations), prevDate, true) },
        });
      }
    } catch (e) {
      setEvents((list) => list.map((x) => (x.id === ev.id ? { ...x, date: prevDate } : x)));
      toast({ message: e instanceof ApiError ? (e.isConflict ? "This event was changed by someone else — the calendar was refreshed." : e.message) : "Move failed.", tone: "error" });
      if (e instanceof ApiError && e.isConflict) router.refresh();
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as { event: ViewEvent } | undefined)?.event ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const ev = (e.active.data.current as { event: ViewEvent } | undefined)?.event;
    const date = (e.over?.data.current as { date: string } | undefined)?.date;
    if (ev && date && date !== ev.date) void moveTo(ev, date);
  }

  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const visible = events.filter((e) => types.has(e.kind));
  const panelOpen = Boolean(selectedId);
  const thisMonth = today.slice(0, 7) === monthKey(year, month);

  return (
    <div className={cx("grid items-start gap-3", panelOpen && "lg:grid-cols-[minmax(0,1fr)_minmax(440px,40%)]")}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-bold text-slate-900">{formatMonthYear(year, month)}</h1>
          <nav aria-label="Change month" className="flex gap-1">
            <Link className={buttonClass("secondary", "sm")} href={monthHref(prev.year, prev.month)} scroll={false}>
              ‹ Prev
            </Link>
            <Link className={buttonClass(thisMonth ? "ghost" : "secondary", "sm")} href={monthHref(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} scroll={false}>
              Today
            </Link>
            <Link className={buttonClass("secondary", "sm")} href={monthHref(next.year, next.month)} scroll={false}>
              Next ›
            </Link>
          </nav>
          <NewEventButton date={thisMonth ? today : `${monthKey(year, month)}-01`} onCreated={(rec) => { upsert(rec); setParam("e", rec.id); }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <WeaponFilterControl value={weapon} onChange={(w) => setParam("w", w === "all" ? null : w)} label="Weapon" size="sm" />
          <div role="group" aria-label="Event types" className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Show</span>
            {EVENT_KINDS.map((k) => {
              const on = types.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const nextTypes = new Set(types);
                    if (on) nextTypes.delete(k);
                    else nextTypes.add(k);
                    setParam("types", nextTypes.size === EVENT_KINDS.length ? null : [...nextTypes].join(","));
                  }}
                  className={cx("touch-target h-7 rounded-md border px-2 text-xs font-semibold", on ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-500 line-through")}
                >
                  {EVENT_KIND_LABEL[k].replace(" / no practice", "")}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Drag a card to another day to move it (times stay the same). Striped cards are drafts; dashed borders are tentative.
        </p>
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            screenReaderInstructions: { draggable: "To move an event with the keyboard, open it and change its date on the Details tab." },
          }}
        >
          <MonthView
            year={year}
            month={month}
            today={today}
            events={visible}
            phases={phases}
            weapon={weapon}
            DayCell={DroppableDay}
            dayActions={(date) => <NewEventButton compact date={date} onCreated={(rec) => { upsert(rec); setParam("e", rec.id); }} />}
            renderCard={(e) => <DraggableCard event={e} weapon={weapon} selected={e.id === selectedId} dense={panelOpen} onOpen={() => setParam("e", e.id)} />}
          />
          <DragOverlay>{dragging ? <div className={cx(cardFrameClass(dragging), "w-48 rotate-1 shadow-xl")}><EventCardBody event={dragging} weapon={weapon} showStatus dense /></div> : null}</DragOverlay>
        </DndContext>
      </div>
      {selectedId ? (
        <EventPanel
          key={selectedId}
          id={selectedId}
          onClose={() => setParam("e", null)}
          onChange={upsert}
          onDeleted={(id) => {
            setEvents((list) => list.filter((e) => e.id !== id));
            setParam("e", null);
          }}
          onCreated={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
