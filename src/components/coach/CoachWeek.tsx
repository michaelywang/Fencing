"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useSyncedState } from "@/components/hooks";
import { api, ApiError } from "@/lib/api-client";
import { addDays, addMinutesToTime, formatClock, formatDateMedium, formatWeekRange, startOfWeek } from "@/lib/dates";
import { INTENSITY_LABEL, PLAN_KINDS, type Intensity } from "@/lib/constants";
import { displayTitle } from "@/lib/practice";
import { analyzePractice, summarizeIssues } from "@/lib/timeline";
import { prepareForSave } from "@/lib/prepare";
import { fromRecord, type EventRecord, type ViewBlock, type ViewEvent } from "@/lib/view";
import type { EventDoc } from "@/lib/schemas";
import { WEAPONS, WEAPON_ABBR, WEAPON_LABEL, parseWeaponFilter, type Lane } from "@/lib/weapons";
import { WeekView } from "@/components/calendar/WeekView";
import type { PhaseLite } from "@/components/calendar/phases";
import { CanceledBadge, EventTypeBadge, PublicationBadge, TentativeBadge } from "@/components/badges";
import { WeaponFilterControl } from "@/components/plan/WeaponFilter";
import { CheckboxField } from "@/components/editor/fields";
import { docFromRecord } from "@/components/editor/useEventEditor";
import { Button, buttonClass, cx, inputClass } from "@/components/ui";
import { Modal, useCoach, useToast } from "./CoachContext";
import { EventPanel } from "./EventPanel";
import { NewEventButton } from "./NewEventButton";
import { useTrack } from "./TrackBar";

export function CoachWeek({ weekStart, initialRecords, phases }: { weekStart: string; initialRecords: EventRecord[]; phases: PhaseLite[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const { locations, today } = useCoach();
  const [records, setRecords] = useSyncedState(initialRecords);
  const [dialog, setDialog] = useState<null | "publish" | "duplicate">(null);
  const { trackId } = useTrack();

  const selectedId = params.get("e");
  const weapon = parseWeaponFilter(params.get("w"));
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const weekHref = (d: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("d", d);
    next.delete("e");
    return `${pathname}?${next.toString()}`;
  };

  const upsert = useCallback((rec: EventRecord) => setRecords((prev) => (prev.some((r) => r.id === rec.id) ? prev.map((r) => (r.id === rec.id ? rec : r)) : [...prev, rec].sort((a, b) => a.date.localeCompare(b.date)))), [setRecords]);
  const views = useMemo(() => records.filter((r) => r.date >= weekStart && r.date <= addDays(weekStart, 6)).map((r) => fromRecord(r, locations)), [records, locations, weekStart]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  async function saveInline(id: string, patch: Partial<EventDoc>) {
    const rec = byId.get(id);
    if (!rec) return;
    try {
      const r = await api<{ event: EventRecord }>(`/api/events/${id}`, { method: "PUT", body: { baseVersion: rec.version, doc: prepareForSave({ ...docFromRecord(rec), ...patch }) } });
      upsert(r.event);
    } catch (e) {
      toast({ message: e instanceof ApiError ? (e.isConflict ? "Changed elsewhere — refreshed with the latest version." : e.message) : "Save failed.", tone: "error" });
      if (e instanceof ApiError && e.isConflict) router.refresh();
    }
  }

  const unpublished = records.filter((r) => r.publication !== "published");

  return (
    <div className={cx("grid items-start gap-3", selectedId && "lg:grid-cols-[minmax(0,1fr)_minmax(440px,40%)]")}>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-bold text-slate-900">Week of {formatWeekRange(weekStart)}</h1>
          <nav aria-label="Change week" className="flex gap-1">
            <Link className={buttonClass("secondary", "sm")} href={weekHref(addDays(weekStart, -7))} scroll={false}>
              ‹ Prev
            </Link>
            <Link className={buttonClass("secondary", "sm")} href={weekHref(startOfWeek(today))} scroll={false}>
              This week
            </Link>
            <Link className={buttonClass("secondary", "sm")} href={weekHref(addDays(weekStart, 7))} scroll={false}>
              Next ›
            </Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WeaponFilterControl value={weapon} onChange={(w) => setParam("w", w === "all" ? null : w)} size="sm" />
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="publish" onClick={() => setDialog("publish")} disabled={unpublished.length === 0}>
              Publish week{unpublished.length ? ` (${unpublished.length})` : ""}
            </Button>
            <a className={buttonClass("secondary", "sm")} href={`/coach/preview?week=${weekStart}&track=${trackId}`} target="_blank" rel="noopener">
              Preview week
            </a>
            <Link className={buttonClass("secondary", "sm")} href={`/coach/publish?week=${weekStart}&track=${trackId}`}>
              Review week vs. published…
            </Link>
            <Button size="sm" onClick={() => setDialog("duplicate")} disabled={records.length === 0}>
              Duplicate week…
            </Button>
            <NewEventButton date={today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart} onCreated={(rec) => { upsert(rec); setParam("e", rec.id); }} />
          </div>
        </div>

        <WeekView
          weekStart={weekStart}
          today={today}
          events={views}
          phases={phases}
          weapon={weapon}
          renderEventHeader={(e) => <CoachEventHeader event={e} selected={e.id === selectedId} onOpen={() => setParam("e", e.id)} onSave={(patch) => saveInline(e.id, patch)} />}
          renderBlock={(e, b, lane) => <BlockButton event={e} block={b} lane={lane} onOpen={() => setParam("e", e.id)} />}
          dayActions={(date, dayEvents) => (
            <div className={cx("flex items-center gap-1", dayEvents.length > 0 && "opacity-70")}>
              {dayEvents.length === 0 ? <span className="text-xs text-slate-400">No event</span> : null}
              <NewEventButton compact date={date} onCreated={(rec) => { upsert(rec); setParam("e", rec.id); }} />
            </div>
          )}
        />
      </div>
      {selectedId ? (
        <EventPanel
          key={selectedId}
          id={selectedId}
          onClose={() => setParam("e", null)}
          onChange={upsert}
          onDeleted={(id) => {
            setRecords((list) => list.filter((r) => r.id !== id));
            setParam("e", null);
          }}
          onCreated={() => router.refresh()}
        />
      ) : null}
      {dialog === "publish" ? <PublishWeekDialog open records={unpublished} trackId={trackId} weekStart={weekStart} onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} /> : null}
      {dialog === "duplicate" ? <DuplicateWeekDialog open weekStart={weekStart} trackId={trackId} onClose={() => setDialog(null)} onDone={(target) => { setDialog(null); router.push(`/coach/week?d=${target}&track=${trackId}`); }} /> : null}
    </div>
  );
}

function BlockButton({ event, block: b, onOpen }: { event: ViewEvent; block: ViewBlock; lane: Lane; onOpen: () => void }) {
  const t = event.startTime ? formatClock(addMinutesToTime(event.startTime, b.start), { compact: true }) : `+${b.start}`;
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded px-0.5 text-left text-[12px] leading-snug hover:bg-white/70">
      <span className="font-semibold text-slate-900">{t}</span> <span className="text-slate-800">{b.title || "Untitled"}</span> <span className="text-slate-500">({b.duration})</span>
      {b.allowOverlap ? <span className="text-slate-500"> · alongside</span> : null}
    </button>
  );
}

function CoachEventHeader({ event, selected, onOpen, onSave }: { event: ViewEvent; selected: boolean; onOpen: () => void; onSave: (patch: Partial<EventDoc>) => Promise<void> }) {
  const [theme, setTheme] = useSyncedState(event.theme);
  const isPlan = PLAN_KINDS.includes(event.kind);
  const timeline = isPlan && event.blocks.length ? analyzePractice(event.blocks, event.targetMinutes) : null;
  const issues = timeline ? summarizeIssues(timeline) : [];
  const coaches = event.coachAssignments;
  return (
    <div className={cx("rounded-md border border-l-4 bg-white p-1.5 text-xs shadow-sm", event.kind === "meet" || event.kind === "tournament" ? "border-l-gl-red" : "border-l-gl-blue", selected ? "ring-2 ring-gl-blue" : "border-slate-200", event.confirmation === "tentative" && "border-dashed")}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-bold text-slate-900">{event.startTime ? formatClock(event.startTime, { compact: true }) : "All day"}</span>
        <EventTypeBadge kind={event.kind} compact />
        {event.publication ? <PublicationBadge state={event.publication} /> : null}
        {event.status === "canceled" ? <CanceledBadge /> : null}
        {event.confirmation === "tentative" ? <TentativeBadge /> : null}
      </div>
      <button type="button" onClick={onOpen} className={cx("mt-0.5 block w-full text-left text-[13px] font-semibold leading-tight text-gl-blue underline-offset-2 hover:underline", event.status === "canceled" && "line-through")}>
        {displayTitle(event)}
      </button>
      {isPlan ? (
        <div className="mt-1 space-y-1">
          <label className="block">
            <span className="sr-only">Theme for {formatDateMedium(event.date)}</span>
            <input
              className={cx(inputClass, "h-7 px-1.5 py-0.5 text-xs")}
              value={theme}
              placeholder="Theme"
              onChange={(e) => setTheme(e.target.value)}
              onBlur={() => theme !== event.theme && void onSave({ theme })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <label className="block">
            <span className="sr-only">Intensity for {formatDateMedium(event.date)}</span>
            <select className={cx(inputClass, "h-7 px-1 py-0.5 text-xs")} value={event.intensity ?? ""} onChange={(e) => void onSave({ intensity: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Intensity —</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} · {INTENSITY_LABEL[n as Intensity]}
                </option>
              ))}
            </select>
          </label>
          {timeline ? (
            <p className="flex flex-wrap gap-1" aria-label="Minutes per weapon">
              {WEAPONS.map((w) => (
                <span key={w} title={`${WEAPON_LABEL[w]}: ${timeline.perWeapon[w].coveredMinutes} of ${event.targetMinutes} min`} className={cx("rounded px-1 font-semibold", timeline.perWeapon[w].ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
                  {WEAPON_ABBR[w]} {timeline.perWeapon[w].coveredMinutes}
                  {timeline.perWeapon[w].ok ? "✓" : "⚠"}
                </span>
              ))}
              <span className="text-slate-500">/ {event.targetMinutes} min</span>
            </p>
          ) : (
            <p className="text-slate-500">No plan yet</p>
          )}
          {issues.length ? <p className="text-amber-800">⚠ {issues.length} timing warning{issues.length === 1 ? "" : "s"}</p> : null}
        </div>
      ) : event.meet?.busDepart ? (
        <p className="mt-0.5 text-slate-700">Bus {formatClock(event.meet.busDepart, { compact: true })}{event.meet.busReturn ? ` · back ~${formatClock(event.meet.busReturn, { compact: true })}` : ""}</p>
      ) : null}
      {coaches && Object.values(coaches).some(Boolean) ? (
        <p className="mt-1 text-[11px] text-slate-600">
          {coaches.shared ? `Lead: ${coaches.shared}` : ""}
          {WEAPONS.filter((w) => coaches[w]).map((w) => ` · ${WEAPON_ABBR[w]}: ${coaches[w]}`)}
        </p>
      ) : null}
    </div>
  );
}

function PublishWeekDialog({ open, records, trackId, weekStart, onClose, onDone }: { open: boolean; records: EventRecord[]; trackId: string; weekStart: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(records.map((r) => r.id)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const chosen = records.filter((r) => selected.has(r.id));
      const res = await api<{ published: number }>("/api/publish", {
        body: { trackId, mode: "selected", rowIds: chosen.map((r) => r.id), note, expectedVersions: Object.fromEntries(chosen.map((r) => [r.id, r.version])), operationId: crypto.randomUUID() },
      });
      toast({ message: `Published ${res.published} event${res.published === 1 ? "" : "s"}. Other dates are unchanged.`, tone: "success" });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "live_conflict") {
        toast({ message: e.message, tone: "error", action: { label: "Review", onClick: () => router.push(`/coach/publish?week=${weekStart}&track=${trackId}`) } });
        return;
      }
      toast({ message: e instanceof ApiError ? (e.isConflict ? "One of these events changed since you opened the week — refresh and review before publishing." : e.message) : "Publishing failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish this week"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="publish" disabled={busy || selected.size === 0} onClick={submit}>
            {busy ? "Publishing…" : `Publish ${selected.size}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Publishes the ticked events&apos; current saved versions from this track — nothing else changes. Private notes are never published. To remove published events or see a full before/after, use “Review week vs. published”.</p>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {records.map((r) => {
            const warn = PLAN_KINDS.includes(r.kind) && r.blocks.length ? summarizeIssues(analyzePractice(r.blocks, r.targetMinutes)).length : 0;
            return (
              <li key={r.id} className="px-3 py-2">
                <CheckboxField
                  label={
                    <span>
                      <strong>{formatDateMedium(r.date)}</strong> · {displayTitle(r)} <PublicationBadge state={r.publication} />
                      {warn ? <span className="ml-1 text-amber-800">⚠ {warn} timing warning{warn === 1 ? "" : "s"}</span> : null}
                    </span>
                  }
                  checked={selected.has(r.id)}
                  onChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v) n.add(r.id); else n.delete(r.id); return n; })}
                />
              </li>
            );
          })}
        </ul>
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Change note (optional, shown on the public site)</span>
          <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Week 3 plans posted" />
        </label>
      </div>
    </Modal>
  );
}

function DuplicateWeekDialog({ open, weekStart, trackId, onClose, onDone }: { open: boolean; weekStart: string; trackId: string; onClose: () => void; onDone: (target: string) => void }) {
  const toast = useToast();
  const [target, setTarget] = useState(addDays(weekStart, 7));
  const [copyCoaches, setCopyCoaches] = useState(true);
  const [copyNotes, setCopyNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const targetMonday = target ? startOfWeek(target) : "";
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ ids: string[] }>("/api/weeks/duplicate", { body: { trackId, sourceWeekStart: weekStart, targetWeekStart: targetMonday, copyCoaches, copyNotes } });
      toast({ message: `Copied ${r.ids.length} events as drafts to the week of ${formatDateMedium(targetMonday)}.`, tone: "success" });
      onDone(targetMonday);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not duplicate the week.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate this week"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !targetMonday || targetMonday === weekStart} onClick={submit}>
            {busy ? "Copying…" : "Copy week"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Copy to the week containing</span>
          <input type="date" className={cx(inputClass, "w-48")} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        {targetMonday ? <p className="text-slate-600">Target week: {formatWeekRange(targetMonday)}. Each event lands on the same weekday with the same local times (daylight-saving safe), as a private draft.</p> : null}
        <CheckboxField label="Copy coach and station assignments" checked={copyCoaches} onChange={setCopyCoaches} />
        <CheckboxField label="Copy private coaching notes" hint="Off by default." checked={copyNotes} onChange={setCopyNotes} />
      </div>
    </Modal>
  );
}
