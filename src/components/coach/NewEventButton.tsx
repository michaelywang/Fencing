"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { addMinutesToTime, formatDateMedium } from "@/lib/dates";
import { EVENT_KIND_LABEL, type EventKind } from "@/lib/constants";
import type { EventRecord } from "@/lib/view";
import { Button, Spinner } from "@/components/ui";
import { Modal, useCoach, useToast } from "./CoachContext";
import { useTrack } from "./TrackBar";

export function defaultEventDoc(kind: EventKind, date: string, s: ReturnType<typeof useCoach>["settings"]) {
  const isPlan = kind === "practice" || kind === "recovery";
  const start = kind === "holiday" ? null : isPlan ? s.defaultPracticeStart : "16:00";
  return {
    kind,
    date,
    startTime: start,
    endTime: start && isPlan ? addMinutesToTime(start, s.defaultPracticeMinutes) : null,
    title: "",
    locationId: isPlan ? s.defaultPracticeLocationId : kind === "meet" ? s.defaultMeetLocationId : null,
    targetMinutes: s.defaultPracticeMinutes,
    meet: kind === "meet" || kind === "tournament" ? { opponent: "", homeAway: null, reportTime: null, busDepart: null, busReturn: null, address: "", details: "" } : null,
    blocks: [],
  };
}

interface TemplateLite {
  id: string;
  name: string;
  description: string;
}

/** "+ New" control: blank event of any type, or a practice from a template. Opens the result in the editor. */
export function NewEventButton({ date, onCreated, compact, label }: { date: string; onCreated: (rec: EventRecord) => void; compact?: boolean; label?: string }) {
  const { trackId } = useTrack();
  const { settings } = useCoach();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null);
  const [day, setDay] = useState(date);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ templates: TemplateLite[] }>(`/api/templates?track=${trackId}`)
      .then((r) => !cancelled && setTemplates(r.templates))
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, [open, trackId]);
  const openDialog = () => {
    setDay(date);
    setOpen(true);
  };

  async function create(kind: EventKind) {
    setBusy(true);
    try {
      const r = await api<{ event: EventRecord }>("/api/events", { body: { trackId, doc: defaultEventDoc(kind, day, settings) } });
      setOpen(false);
      onCreated(r.event);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not create the event.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function fromTemplate(id: string) {
    setBusy(true);
    try {
      const r = await api<{ event: EventRecord }>(`/api/templates/${id}/apply`, { body: { trackId, date: day } });
      setOpen(false);
      onCreated(r.event);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not apply the template.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={openDialog}
          aria-label={`Add event on ${formatDateMedium(date)}`}
          title="Add event"
          className="touch-target flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-gl-blue-soft hover:text-gl-blue focus:text-gl-blue"
        >
          +
        </button>
      ) : (
        <Button size="sm" variant="primary" onClick={openDialog}>
          {label ?? "+ New event"}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New event">
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-0.5 block text-xs font-semibold text-slate-700">Date</span>
            <input type="date" className="rounded-md border border-slate-300 px-2 py-1.5" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Blank event (starts as a private draft)</p>
            <div className="flex flex-wrap gap-2">
              {(["practice", "meet", "tournament", "recovery", "holiday", "other"] as EventKind[]).map((k) => (
                <Button key={k} size="sm" disabled={busy} onClick={() => create(k)}>
                  {EVENT_KIND_LABEL[k]}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Practice from a template</p>
            {templates === null ? <Spinner label="Loading templates" /> : null}
            {templates?.length === 0 ? <p className="text-slate-500">No templates yet — open any practice and choose More → Save as template.</p> : null}
            <ul className="space-y-1">
              {templates?.map((t) => (
                <li key={t.id}>
                  <button type="button" disabled={busy} onClick={() => fromTemplate(t.id)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
                    <span className="font-semibold text-slate-900">{t.name}</span>
                    {t.description ? <span className="block text-xs text-slate-600">{t.description}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}
