"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDateMedium, formatTimestamp } from "@/lib/dates";
import { displayTitle } from "@/lib/practice";
import type { EventRecord } from "@/lib/view";
import { Button, EmptyState, Notice, Spinner } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";

interface Trash {
  events: EventRecord[];
  drills: Array<{ id: string; title: string; deletedAt: string | null }>;
  templates: Array<{ id: string; name: string; deletedAt: string | null }>;
}

export function TrashPage() {
  const toast = useToast();
  const { settings } = useCoach();
  const [data, setData] = useState<Trash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Trash>("/api/trash")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the trash."));
  }, []);
  useEffect(load, [load]);

  async function restore(url: string, label: string) {
    try {
      await api(url, { body: {} });
      toast({ message: `Restored ${label}.`, tone: "success" });
      load();
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : "Restore failed.", tone: "error" });
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Spinner label="Loading trash" />;
  const empty = data.events.length + data.drills.length + data.templates.length === 0;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Trash</h1>
      <p className="text-sm text-slate-600">Deleted items stay here for at least 90 days. Restoring an event that was published also restores its public version.</p>
      {empty ? <EmptyState title="Trash is empty" /> : null}
      {data.events.length ? (
        <section>
          <h2 className="mb-1 text-sm font-bold text-slate-800">Events</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="w-24 font-semibold text-slate-700">{formatDateMedium(e.date)}</span>
                <span className="flex-1">{displayTitle(e)}</span>
                <span className="text-xs text-slate-500">deleted {e.deletedAt ? formatTimestamp(e.deletedAt, settings.timezone) : ""}</span>
                <Button size="sm" onClick={() => restore(`/api/events/${e.id}/undelete`, displayTitle(e))}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.drills.length ? (
        <section>
          <h2 className="mb-1 text-sm font-bold text-slate-800">Library drills</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.drills.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{d.title}</span>
                <Button size="sm" onClick={() => restore(`/api/drills/${d.id}/restore`, d.title)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.templates.length ? (
        <section>
          <h2 className="mb-1 text-sm font-bold text-slate-800">Templates</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.templates.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{t.name}</span>
                <Button size="sm" onClick={() => restore(`/api/templates/${t.id}/restore`, t.name)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
