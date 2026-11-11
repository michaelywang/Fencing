"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { LogisticsValues } from "@/lib/fromPublic";
import type { EventRecord } from "@/lib/view";
import { formatClock, formatDateMedium } from "@/lib/dates";
import { Modal, useCoach, useToast } from "@/components/coach/CoachContext";
import { Button, Notice, Spinner, cx, inputClass } from "@/components/ui";

interface LiveLogistics {
  generation: number;
  values: LogisticsValues;
  notice: { at: string; text: string } | null;
  kind: string;
  hasMeet: boolean;
}

interface Conflict {
  field: string;
  label: string;
  original: string | null;
  yours: string | null;
  live: string | null;
}

const show = (v: string | null) => (v === null || v === "" ? "—" : /^\d\d:\d\d$/.test(v) ? formatClock(v) : /^\d{4}-\d\d-\d\d$/.test(v) ? formatDateMedium(v) : v);

/**
 * Quick logistics update: change date, times, venue, report and bus times of a
 * PUBLISHED event and publish ONLY those fields now. The starting point is
 * what students currently see — not this track's unfinished draft — so draft
 * drill or plan edits stay private. The working copy gets the same fields.
 */
export function LogisticsDialog({
  logicalId,
  rowId,
  trackId,
  beforeOpen,
  onClose,
  onDone,
}: {
  logicalId: string;
  /** This track's working copy (its logistics fields are reconciled). */
  rowId: string;
  trackId: string;
  beforeOpen: () => Promise<boolean>;
  onClose: () => void;
  onDone: (rec: EventRecord | null) => void;
}) {
  const toast = useToast();
  const { locations } = useCoach();
  const [live, setLive] = useState<LiveLogistics | null>(null);
  const [v, setV] = useState<LogisticsValues | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [opId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await beforeOpen())) {
        if (!cancelled) setError("Your latest edits couldn't be saved yet. Resolve that first so nothing is lost.");
        return;
      }
      try {
        const r = await api<{ logistics: LiveLogistics | null }>(`/api/live/${logicalId}`);
        if (cancelled) return;
        if (!r.logistics) setError("This event isn't on the public schedule, so there is nothing to update for students. Publish it first.");
        else {
          setLive(r.logistics);
          setV(r.logistics.values);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load the published version.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicalId]);

  async function submit(force = false) {
    if (!live || !v) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/live/${logicalId}/logistics`, { body: { trackId, basedOn: { generation: live.generation, values: live.values }, values: v, note, force, operationId: force ? crypto.randomUUID() : opId } });
      const rec = await api<{ event: EventRecord }>(`/api/events/${rowId}`).then((r) => r.event).catch(() => null);
      toast({ tone: "success", message: "Logistics update published — students see the new details and a short change notice." });
      onDone(rec);
    } catch (e) {
      if (e instanceof ApiError && e.code === "logistics_conflict") setConflicts((e.details as { conflicts: Conflict[] }).conflicts);
      else setError(e instanceof ApiError ? e.message : "The update was not published.");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<LogisticsValues>) => setV((cur) => (cur ? { ...cur, ...patch } : cur));
  const changed = live && v ? (Object.keys(v) as Array<keyof LogisticsValues>).filter((k) => v[k] !== live.values[k]) : [];
  return (
    <Modal
      open
      onClose={onClose}
      title="Quick logistics update"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {conflicts ? (
            <Button variant="danger" disabled={busy} onClick={() => void submit(true)}>
              Publish mine anyway
            </Button>
          ) : (
            <Button variant="publish" disabled={busy || !live || changed.length === 0} onClick={() => void submit(false)} data-testid="publish-logistics">
              Publish this update now
            </Button>
          )}
        </>
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!live || !v ? (
        error ? null : <Spinner label="Loading the published version" />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-700">
            Starts from what students see now. Only the fields below are published — unfinished plan or drill edits in this track stay private. The event keeps its link.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              <span className="block text-xs font-semibold text-slate-700">Date</span>
              <input type="date" className={inputClass} value={v.date} onChange={(e) => set({ date: e.target.value })} />
            </label>
            <label>
              <span className="block text-xs font-semibold text-slate-700">Start</span>
              <input type="time" className={inputClass} value={v.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value || null })} />
            </label>
            <label>
              <span className="block text-xs font-semibold text-slate-700">End</span>
              <input type="time" className={inputClass} value={v.endTime ?? ""} onChange={(e) => set({ endTime: e.target.value || null })} />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700">Venue</span>
            <select
              className={inputClass}
              value={v.locationId ?? ""}
              onChange={(e) => {
                const loc = locations.find((l) => l.id === e.target.value);
                set({ locationId: loc?.id ?? null, venue: loc ? loc.name : v.locationId ? "" : v.venue });
              }}
            >
              <option value="">Other venue (type below)</option>
              {locations
                .filter((l) => !l.archivedAt || l.id === v.locationId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            {!v.locationId ? <input aria-label="Venue name" className={cx(inputClass, "mt-1")} value={v.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="Venue name and room" /> : null}
          </label>
          {live.hasMeet ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <label>
                <span className="block text-xs font-semibold text-slate-700">Report time</span>
                <input type="time" className={inputClass} value={v.reportTime ?? ""} onChange={(e) => set({ reportTime: e.target.value || null })} />
              </label>
              <label>
                <span className="block text-xs font-semibold text-slate-700">Bus departs</span>
                <input type="time" className={inputClass} value={v.busDepart ?? ""} onChange={(e) => set({ busDepart: e.target.value || null })} />
              </label>
              <label>
                <span className="block text-xs font-semibold text-slate-700">Bus returns</span>
                <input type="time" className={inputClass} value={v.busReturn ?? ""} onChange={(e) => set({ busReturn: e.target.value || null })} />
              </label>
            </div>
          ) : null}
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700">Change notice for students (optional — a short summary is written automatically)</span>
            <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Snow: practice moved to Tuesday 4:00" />
          </label>
          {changed.length ? <p className="text-xs text-slate-600">Will publish: {changed.join(", ")}.</p> : <p className="text-xs text-slate-600">Change at least one field.</p>}
          {conflicts ? (
            <Notice tone="warn">
              <p className="font-semibold">Another coach changed these after you opened this dialog:</p>
              <ul className="ml-4 list-disc">
                {conflicts.map((c) => (
                  <li key={c.field}>
                    {c.label}: now {show(c.live)} (was {show(c.original)}; you entered {show(c.yours)})
                  </li>
                ))}
              </ul>
              <p>Cancel to keep their change, or publish yours anyway.</p>
            </Notice>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

interface Publication {
  id: string;
  action: string;
  createdAt: string;
  trackName: string | null;
  userName: string | null;
  summary: string;
  notice: string | null;
  canUndo: boolean;
  isLatest: boolean;
}

const ACTION: Record<string, string> = {
  publish: "Published",
  replace: "Published (schedule replacement)",
  cancel: "Published cancellation",
  reinstate: "Published reinstatement",
  unpublish: "Removed from public",
  delete: "Deleted (removed from public)",
  clear: "Cleared from public",
  "restore-backup": "Restored from a backup",
  "trash-restore": "Republished from Trash",
  logistics: "Logistics update",
  "logistics-undo": "Logistics update undone",
  migrated: "Published (before tracks)",
};

/** The public-change history of this event (all tracks), with undo for logistics updates. */
export function PublicHistory({ logicalId, trackId, onUndone }: { logicalId: string; trackId: string; onUndone: () => void }) {
  const toast = useToast();
  const { settings } = useCoach();
  const [list, setList] = useState<Publication[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<{ publications: Publication[] }>(`/api/live/${logicalId}`)
      .then((r) => !cancelled && setList(r.publications))
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [logicalId, tick]);
  async function undo(p: Publication, force = false) {
    try {
      await api(`/api/live/${logicalId}/undo`, { body: { publicationId: p.id, trackId, force, operationId: crypto.randomUUID() } });
      toast({ tone: "success", message: "Undone — students see the earlier details again (with a short notice)." });
      setTick((t) => t + 1);
      onUndone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "logistics_conflict" && window.confirm(`${e.message} Undo anyway?`)) return undo(p, true);
      toast({ tone: "error", message: e instanceof ApiError ? e.message : "Undo failed." });
    }
  }
  if (!list) return <Spinner label="Loading public history" />;
  if (!list.length) return <p className="text-sm text-slate-600">Never published.</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm" data-testid="public-history">
      {list.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="font-semibold text-slate-900">{ACTION[p.action] ?? p.action}</span>
          <span className="text-slate-600">{formatTimestamp(p.createdAt, settings.timezone)}</span>
          {p.userName ? <span className="text-slate-600">{p.userName}</span> : null}
          {p.trackName ? <span className="text-slate-600">from {p.trackName}</span> : null}
          <span className="w-full text-xs text-slate-600">{p.notice ? `Notice: “${p.notice}”` : p.summary}</span>
          {p.canUndo ? (
            <Button size="sm" onClick={() => void undo(p)}>
              Undo this update
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatTimestamp(v: string, tz: string) {
  return new Date(v).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
