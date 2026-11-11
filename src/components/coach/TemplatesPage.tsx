"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { EventRecord } from "@/lib/view";
import { fromDoc } from "@/lib/view";
import { analyzePractice } from "@/lib/timeline";
import type { TemplateDoc } from "@/lib/schemas";
import { formatClock } from "@/lib/dates";
import { WEAPONS, WEAPON_LABEL } from "@/lib/weapons";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { Button, EmptyState, Notice, Spinner, inputClass } from "@/components/ui";
import { Modal, useCoach, useToast } from "./CoachContext";
import { useTrack } from "./TrackBar";

interface Template {
  id: string;
  name: string;
  description: string;
  doc: TemplateDoc;
  version: number;
  isDemo: boolean;
  trackId: string | null;
}

export function TemplatesPage() {
  const router = useRouter();
  const toast = useToast();
  const { today, locations } = useCoach();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyFor, setApplyFor] = useState<Template | null>(null);
  const [previewFor, setPreviewFor] = useState<Template | null>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const { trackId, track } = useTrack();

  const load = useCallback(() => {
    api<{ templates: Template[] }>(`/api/templates?track=${trackId}`)
      .then((r) => setTemplates(r.templates))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load templates."));
  }, [trackId]);

  async function promote(t: Template) {
    if (!window.confirm(`Make “${t.name}” a SHARED template for every track?`)) return;
    try {
      await api(`/api/templates/${t.id}/promote`, { body: {} });
      toast({ message: `“${t.name}” is now shared.`, tone: "success" });
      load();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not share the template.", tone: "error" });
    }
  }
  useEffect(load, [load]);

  async function apply() {
    if (!applyFor) return;
    setBusy(true);
    try {
      const r = await api<{ event: EventRecord }>(`/api/templates/${applyFor.id}/apply`, { body: { trackId, date } });
      toast({ message: `Created a draft practice in ${track?.name ?? "this track"} on ${date} from “${applyFor.name}”.`, tone: "success" });
      router.push(`/coach/calendar?m=${date.slice(0, 7)}&e=${r.event.id}&track=${trackId}`);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not apply the template.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function rename(t: Template) {
    const name = window.prompt("Template name", t.name);
    if (!name || name === t.name) return;
    try {
      await api(`/api/templates/${t.id}`, { method: "PUT", body: { baseVersion: t.version, template: { name, description: t.description, doc: t.doc } } });
      load();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Rename failed.", tone: "error" });
    }
  }

  async function remove(t: Template) {
    try {
      await api(`/api/templates/${t.id}`, { method: "DELETE" });
      load();
      toast({ message: `Deleted template “${t.name}”.`, action: { label: "Undo", onClick: () => void api(`/api/templates/${t.id}/restore`, { body: {} }).then(load) } });
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Delete failed.", tone: "error" });
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold text-slate-900">Practice templates</h1>
      <p className="text-sm text-slate-600">
        A template is a reusable practice plan. Create one from any practice (<strong>More → Save as template</strong>), then use it on new dates. Each use creates an independent draft in the track open in this tab.
        Shared templates appear in every track; “Only in …” templates belong to one track (for experiments or imports).
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {templates === null && !error ? <Spinner label="Loading templates" /> : null}
      {templates?.length === 0 ? <EmptyState title="No templates yet">Open a practice you like and choose More → Save as template.</EmptyState> : null}
      <ul className="grid gap-2 lg:grid-cols-2">
        {templates?.map((t) => {
          const timing = analyzePractice(t.doc.blocks, t.doc.targetMinutes);
          return (
            <li key={t.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <h2 className="font-semibold text-slate-900">
                {t.name} {t.isDemo ? <span className="rounded bg-fuchsia-100 px-1 text-[11px] font-semibold text-fuchsia-900">Demo</span> : null}
                {t.trackId ? <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">Only in {track?.name}</span> : null}
              </h2>
              {t.description ? <p className="text-sm text-slate-700">{t.description}</p> : null}
              <p className="mt-1 text-xs text-slate-600">
                {t.doc.blocks.length} blocks · {t.doc.targetMinutes} min target{t.doc.startTime ? ` · starts ${formatClock(t.doc.startTime)}` : ""} ·{" "}
                {WEAPONS.map((w) => `${WEAPON_LABEL[w]} ${timing.perWeapon[w].coveredMinutes}`).join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => { setApplyFor(t); setDate(today); }}>
                  Use on a date…
                </Button>
                <Button size="sm" onClick={() => setPreviewFor(t)}>
                  Preview
                </Button>
                <Button size="sm" onClick={() => rename(t)}>
                  Rename
                </Button>
                {t.trackId ? (
                  <Button size="sm" onClick={() => void promote(t)}>
                    Make shared…
                  </Button>
                ) : null}
                <Button size="sm" variant="danger" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal
        open={applyFor !== null}
        onClose={() => setApplyFor(null)}
        title={`Use “${applyFor?.name ?? ""}”`}
        footer={
          <>
            <Button onClick={() => setApplyFor(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !date} onClick={apply}>
              Create draft practice
            </Button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Date</span>
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </Modal>
      <Modal open={previewFor !== null} onClose={() => setPreviewFor(null)} title={previewFor?.name ?? "Template"} wide>
        {previewFor ? <PracticePlan event={fromDoc("template", { ...previewFor.doc, date: today, confirmation: "confirmed", status: "scheduled", cancelReason: "", locationNote: "", meet: null, links: [], completedNotes: "" }, locations)} coachView sectionsOpen={false} /> : null}
      </Modal>
    </div>
  );
}
