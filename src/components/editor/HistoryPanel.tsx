"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatTimestamp } from "@/lib/dates";
import { fromDoc, type EventRecord } from "@/lib/view";
import type { EventDoc } from "@/lib/schemas";
import { Modal, useCoach, useToast } from "@/components/coach/CoachContext";
import { EventSummary } from "@/components/plan/EventSummary";
import { PracticePlan } from "@/components/plan/PracticePlan";
import { Button, Notice, Spinner } from "@/components/ui";

interface Revision {
  id: string;
  version: number;
  action: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  publish: "Published",
  unpublish: "Unpublished",
  cancel: "Canceled",
  reinstate: "Reinstated",
  move: "Moved",
  duplicate: "Copied",
  import: "Imported",
  template: "From template",
  restore: "Restored",
  discard: "Discarded changes",
  delete: "Deleted",
  undelete: "Restored from trash",
};

export function HistoryPanel({ eventId, baseVersion, onRestored, beforeRestore }: { eventId: string; baseVersion: () => number; onRestored: (rec: EventRecord) => void; beforeRestore: () => Promise<unknown> }) {
  const { settings, locations } = useCoach();
  const toast = useToast();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rev: Revision; doc: EventDoc } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ revisions: Revision[] }>(`/api/events/${eventId}/revisions`)
      .then((r) => setRevisions(r.revisions))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load history."));
  }, [eventId]);
  useEffect(load, [load]);

  async function openPreview(rev: Revision) {
    try {
      const r = await api<{ revision: { snapshot: EventDoc } }>(`/api/events/${eventId}/revisions/${rev.id}`);
      setPreview({ rev, doc: r.revision.snapshot });
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Could not load that version.", tone: "error" });
    }
  }

  async function restore(rev: Revision) {
    if (!window.confirm(`Restore the version from ${formatTimestamp(rev.updatedAt, settings.timezone)}? The current version stays in history, so you can undo this.`)) return;
    setBusy(true);
    try {
      await beforeRestore();
      const r = await api<{ event: EventRecord }>(`/api/events/${eventId}/restore`, { body: { revisionId: rev.id, baseVersion: baseVersion() } });
      onRestored(r.event);
      setPreview(null);
      toast({ message: r.event.publication === "changed" ? "Version restored as a draft. Publish to update the public calendar." : "Version restored.", tone: "success" });
      load();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Restore failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!revisions) return <Spinner label="Loading history" />;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Every save is recorded (rapid edits by the same coach are grouped). Restoring creates a new version; nothing is lost.</p>
      <ol className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {revisions.map((rev, i) => (
          <li key={rev.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {ACTION_LABEL[rev.action] ?? rev.action}
                {i === 0 ? <span className="ml-2 rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">latest</span> : null}
              </p>
              <p className="text-xs text-slate-600">
                {formatTimestamp(rev.updatedAt, settings.timezone)} · {rev.userName ?? "unknown"} · v{rev.version}
                {rev.summary ? ` · ${rev.summary}` : ""}
              </p>
            </div>
            <Button size="sm" onClick={() => openPreview(rev)}>
              View
            </Button>
            {i > 0 ? (
              <Button size="sm" onClick={() => restore(rev)} disabled={busy}>
                Restore
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <Modal open={preview !== null} onClose={() => setPreview(null)} title={preview ? `Version from ${formatTimestamp(preview.rev.updatedAt, settings.timezone)}` : "Version"} wide footer={preview ? <><Button onClick={() => setPreview(null)}>Close</Button><Button variant="primary" onClick={() => restore(preview.rev)} disabled={busy}>Restore this version</Button></> : null}>
        {preview ? (
          <div className="space-y-4">
            <EventSummary event={fromDoc(eventId, preview.doc, locations)} headingLevel={2} />
            <PracticePlan event={fromDoc(eventId, preview.doc, locations)} coachView sectionsOpen={false} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
